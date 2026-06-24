-- Phase 8.1: light up the building bazaar. The buildings / building_memberships tables and their
-- RLS have existed since 0004; nothing has populated them yet. This migration adds:
--   (1) stores.normalized_key — the grouping key, written by the TS normalizer (lib/actions/settings
--       updateContactInfo). SQL never re-implements the address regex (hard invariant 2 stays in one
--       place); the grouping RPC reads this column verbatim.
--   (2) A per-store grouping RPC (idempotent upsert of building + membership) called both inline on a
--       visibility/address change and from the nightly bulk RPC.
--   (3) A pg_cron nightly backstop (sidesteps the Cloudflare 5-trigger account cap from Phase 7).
--   (4) A tightening of the anon grant on stores so normalized_key (which embeds the street line) and
--       the private pickup note never reach the public role.
--   (5) A tightening of the anon grant on buildings so postal_code also stays off public bazaar
--       responses; route/UI surfaces do not need it.

-- ---------------------------------------------------------------------------
-- stores.normalized_key
-- ---------------------------------------------------------------------------

alter table public.stores add column if not exists normalized_key text;

create index if not exists stores_normalized_key_idx
  on public.stores (normalized_key)
  where normalized_key is not null;

create index if not exists products_store_active_available_created_idx
  on public.products (store_id, created_at desc)
  where is_active = true and (qty_available is null or qty_available > 0);

-- normalized_key embeds the exact street line + postal code. anon must never read it (it is not on
-- any public projection). Replace the blanket anon SELECT with an explicit, non-PII column grant —
-- also drops the previously over-granted pickup_private_note / seller_id / first_scan_* columns.
revoke select on public.stores from anon;
grant select (
  id, slug, name, category, description, logo_url, is_active, visibility,
  pickup_method, pickup_window_label, pickup_public_note, accept_pay_at_pickup,
  order_count_week, created_at, updated_at
) on public.stores to anon;

revoke select on public.buildings from anon;
grant select (id, display_name, city, public_slug, access_type, created_at)
  on public.buildings to anon;

-- Invite-only means "not enumerable with the anon key." The page can still render after the signed
-- code cookie is validated server-side, but raw public Supabase reads should only see open bazaars.
create or replace function private.is_public_bazaar_building(p_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.buildings b
    where b.id = p_building_id
      and b.access_type = 'open'
  );
$$;

create or replace function private.building_has_active_membership(p_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.building_memberships m
    join public.buildings b on b.id = m.building_id
    where m.building_id = p_building_id
      and m.status = 'active'
      and b.access_type = 'open'
  );
$$;

revoke all on function private.is_public_bazaar_building(uuid) from public;
grant execute on function private.is_public_bazaar_building(uuid) to anon;

drop policy if exists building_memberships_active_select on public.building_memberships;
create policy building_memberships_active_select on public.building_memberships
  for select to anon
  using (status = 'active' and private.is_public_bazaar_building(building_id));

-- ---------------------------------------------------------------------------
-- Grouping RPCs
-- ---------------------------------------------------------------------------

-- Per-store: upsert the building keyed on normalized_key and the store's single membership row.
-- Idempotent — buildings are unique by normalized_key, so a second run never mints a duplicate
-- building, and the membership upsert keys on the unique store_id. Public schema (so the settings
-- server action can reach it through PostgREST with the service-role client) but
-- granted to service_role only — anon/authenticated can never call it.
create or replace function public.sync_store_building_membership(p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_is_active boolean;
  v_visibility public.store_visibility;
  v_street text;
  v_postal text;
  v_building_id uuid;
  v_status public.membership_status;
begin
  select normalized_key, is_active, visibility
    into v_key, v_is_active, v_visibility
  from public.stores
  where id = p_store_id;

  -- No usable address yet (or store gone): make sure no stale membership lingers, then bail.
  if v_key is null or position('|' in v_key) = 0 then
    update public.building_memberships
      set status = 'removed'
      where store_id = p_store_id and status <> 'removed';
    return;
  end if;

  v_street := split_part(v_key, '|', 1);
  v_postal := split_part(v_key, '|', 2);

  insert into public.buildings (normalized_key, display_name, postal_code, public_slug)
  values (
    v_key,
    -- Never publish a street-derived display name. Sellers can rename the building later; the
    -- grouping key stays internal.
    'Building bazaar',
    nullif(v_postal, ''),
    'bazaar-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  )
  on conflict (normalized_key) do nothing;

  select id into v_building_id from public.buildings where normalized_key = v_key;

  -- Visible only when the store is live AND has opted in. nearby is treated as building for v1.
  v_status := case
    when v_is_active and v_visibility in ('building', 'nearby')
      then 'active'::public.membership_status
    else 'removed'::public.membership_status
  end;

  insert into public.building_memberships (building_id, store_id, status, joined_at)
  values (
    v_building_id,
    p_store_id,
    v_status,
    case when v_status = 'active' then now() else null end
  )
  on conflict (store_id) do update
    set building_id = excluded.building_id,
        status = excluded.status,
        joined_at = case
          when excluded.status = 'active' and public.building_memberships.joined_at is null
            then now()
          else public.building_memberships.joined_at
        end;
end;
$$;

-- Public bazaar product highlights. The page needs one top buyable product per seller plus a tiny
-- recent-drops row; fetching every active product for every building member and trimming in Next.js
-- does not scale. This keeps the heavy partitioning in Postgres and returns only the public fields.
create or replace function public.get_building_product_highlights(
  p_building_id uuid,
  p_drop_limit integer default 8
)
returns table (
  section text,
  store_id uuid,
  product_id uuid,
  product_name text,
  price_cents integer,
  image_url text,
  qty_available integer,
  shop_name text,
  shop_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  with active_members as materialized (
    select
      st.id as store_id,
      st.name as shop_name,
      st.slug as shop_slug
    from public.building_memberships m
    join public.stores st on st.id = m.store_id
    where m.building_id = p_building_id
      and m.status = 'active'
      and st.is_active = true
      and st.visibility in ('building', 'nearby')
  ),
  buyable_products as materialized (
    select
      p.id,
      p.store_id,
      p.name,
      p.price_cents,
      p.image_url,
      p.qty_available,
      p.created_at,
      am.shop_name,
      am.shop_slug,
      row_number() over (
        partition by p.store_id
        order by p.created_at desc, p.id desc
      ) as store_rank,
      row_number() over (
        order by p.created_at desc, p.id desc
      ) as drop_rank
    from public.products p
    join active_members am on am.store_id = p.store_id
    where p.is_active = true
      and (p.qty_available is null or p.qty_available > 0)
  )
  select
    'top'::text as section,
    store_id,
    id as product_id,
    name as product_name,
    price_cents,
    image_url,
    qty_available,
    shop_name,
    shop_slug
  from buyable_products
  where store_rank = 1

  union all

  select
    'drop'::text as section,
    store_id,
    id as product_id,
    name as product_name,
    price_cents,
    image_url,
    qty_available,
    shop_name,
    shop_slug
  from buyable_products
  where drop_rank <= least(greatest(p_drop_limit, 0), 24);
$$;

-- Bulk: the nightly cron entry point. Walks every store and re-syncs it. Idempotent — a second run
-- produces identical building/membership rows. Kept set-based so the nightly backstop does not turn
-- into one Postgres function call per store as the seller count grows.
create or replace function public.sync_buildings_and_memberships()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with keyed_stores as materialized (
    select
      id,
      normalized_key,
      is_active,
      visibility,
      split_part(normalized_key, '|', 2) as postal_code
    from public.stores
    where normalized_key is not null
      and position('|' in normalized_key) > 0
  ),
  inserted_buildings as (
    insert into public.buildings (normalized_key, display_name, postal_code, public_slug)
    select distinct on (normalized_key)
      normalized_key,
      'Building bazaar',
      nullif(postal_code, ''),
      'bazaar-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
    from keyed_stores
    on conflict (normalized_key) do nothing
    returning id
  ),
  target_memberships as materialized (
    select
      b.id as building_id,
      s.id as store_id,
      case
        when s.is_active and s.visibility in ('building', 'nearby')
          then 'active'::public.membership_status
        else 'removed'::public.membership_status
      end as status
    from keyed_stores s
    join public.buildings b on b.normalized_key = s.normalized_key
  ),
  upserted_memberships as (
    insert into public.building_memberships (building_id, store_id, status, joined_at)
    select
      building_id,
      store_id,
      status,
      case when status = 'active' then now() else null end
    from target_memberships
    on conflict (store_id) do update
      set building_id = excluded.building_id,
          status = excluded.status,
          joined_at = case
            when excluded.status = 'active' and public.building_memberships.joined_at is null
              then now()
            else public.building_memberships.joined_at
          end
    returning id
  ),
  removed_missing_key as (
    update public.building_memberships m
      set status = 'removed'
    from public.stores s
    where s.id = m.store_id
      and (
        s.normalized_key is null
        or position('|' in s.normalized_key) = 0
      )
      and m.status <> 'removed'
    returning m.id
  ),
  touched as (
    select count(*) as n from inserted_buildings
    union all
    select count(*) from upserted_memberships
    union all
    select count(*) from removed_missing_key
  )
  select (select count(*) from public.stores) into v_count
  from (select sum(n) from touched) applied;

  return v_count;
end;
$$;

-- Server-only. The cron runs SECURITY DEFINER as the function owner; the settings action calls the
-- per-store function through the service-role client. Neither is reachable by anon/authenticated.
revoke all on function public.sync_store_building_membership(uuid) from public, anon, authenticated;
grant execute on function public.sync_store_building_membership(uuid) to service_role;

revoke all on function public.get_building_product_highlights(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_building_product_highlights(uuid, integer) to service_role;

revoke all on function public.sync_buildings_and_memberships() from public, anon, authenticated;
grant execute on function public.sync_buildings_and_memberships() to service_role;

-- ---------------------------------------------------------------------------
-- Nightly schedule (pg_cron). 02:00 UTC. Re-runnable: drop any prior job of the same name first.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-buildings') then
    perform cron.unschedule('sync-buildings');
  end if;
  perform cron.schedule(
    'sync-buildings',
    '0 2 * * *',
    'select public.sync_buildings_and_memberships();'
  );
end;
$$;
