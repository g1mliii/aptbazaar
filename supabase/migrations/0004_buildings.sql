-- Phase 2.3 + 2.5: buildings and memberships.
-- normalized_key (lower(street)|POSTALCODE) is the ONLY grouping key. Display names are
-- seller-supplied and never used for grouping. Unit numbers never enter this table.

create type public.building_access_type as enum ('open', 'invite');
create type public.membership_status as enum ('pending', 'active', 'removed');

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  normalized_key text not null unique,
  display_name text not null,
  city text,
  postal_code text,
  public_slug text not null unique,
  access_type public.building_access_type not null default 'open',
  -- One shared 8-char code per invite building (printed on its QR poster, not per-recipient).
  invite_code text,
  invite_code_rotated_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.building_memberships (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  store_id uuid not null unique references public.stores (id) on delete cascade,
  status public.membership_status not null default 'pending',
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now()
);

create index building_memberships_building_status_idx
  on public.building_memberships (building_id, status);

-- SECURITY DEFINER so the buildings anon policy doesn't depend on the membership policy.
create or replace function public.building_has_active_membership(p_building_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.building_memberships m
    where m.building_id = p_building_id and m.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- buildings RLS
-- ---------------------------------------------------------------------------

alter table public.buildings enable row level security;

-- Column-level grant: anon never sees invite_code / invite_code_rotated_at (the shared secret),
-- nor normalized_key (it embeds the exact street line; buildingPublicSchema omits it too).
grant select (id, display_name, city, postal_code, public_slug, access_type, created_at)
  on public.buildings to anon;
grant select on public.buildings to authenticated;

-- Public bazaar page: anon may read a building only once it has an active member.
create policy buildings_anon_public_select on public.buildings
  for select to anon using (building_has_active_membership(id));
-- A seller who has a membership in the building may read the full row (incl. invite_code).
create policy buildings_member_select on public.buildings
  for select to authenticated using (
    exists (
      select 1 from public.building_memberships m
      join public.stores st on st.id = m.store_id
      where m.building_id = buildings.id and is_store_owner(st.id)
    )
  );

-- ---------------------------------------------------------------------------
-- building_memberships RLS
-- ---------------------------------------------------------------------------

alter table public.building_memberships enable row level security;

grant select on public.building_memberships to anon;
grant select, update on public.building_memberships to authenticated;

-- Store owner manages their own membership row.
create policy building_memberships_owner_select on public.building_memberships
  for select to authenticated using (is_store_owner(store_id));
create policy building_memberships_owner_update on public.building_memberships
  for update to authenticated using (is_store_owner(store_id)) with check (is_store_owner(store_id));
-- Anyone viewing a bazaar may see its active members.
create policy building_memberships_active_select on public.building_memberships
  for select to anon using (status = 'active');

grant all on public.buildings, public.building_memberships to service_role;
