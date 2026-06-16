-- Supabase linter cleanup for SECURITY DEFINER functions exposed through the
-- public API schema. Internal RLS helpers move to a non-exposed schema; the one
-- intentional public RPC, get_order_by_token, becomes SECURITY INVOKER and uses
-- short-lived local request state plus RLS instead of bypassing RLS.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.current_seller_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.sellers s
  where s.user_id = (select auth.uid());
$$;

create or replace function private.is_store_owner(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores st
    where st.id = p_store_id
      and st.seller_id = (select private.current_seller_id())
  );
$$;

create or replace function private.is_store_active(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores st
    where st.id = p_store_id
      and st.is_active = true
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
    where m.building_id = p_building_id
      and m.status = 'active'
  );
$$;

create or replace function private.has_valid_order_tracking_token(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.order_tracking_tokens t
    where t.order_id = p_order_id
      and t.expires_at > now()
      and t.token = nullif(current_setting('stoop.order_tracking_token', true), '')
  );
$$;

revoke all on function private.current_seller_id() from public;
revoke all on function private.is_store_owner(uuid) from public;
revoke all on function private.is_store_active(uuid) from public;
revoke all on function private.building_has_active_membership(uuid) from public;
revoke all on function private.has_valid_order_tracking_token(uuid) from public;

grant execute on function private.current_seller_id() to authenticated;
grant execute on function private.is_store_owner(uuid) to authenticated;
grant execute on function private.is_store_active(uuid) to anon, authenticated;
grant execute on function private.building_has_active_membership(uuid) to anon;
grant execute on function private.has_valid_order_tracking_token(uuid) to anon, authenticated;

drop policy if exists stores_owner_select on public.stores;
drop policy if exists stores_owner_insert on public.stores;
drop policy if exists stores_owner_update on public.stores;

create policy stores_owner_select on public.stores
  for select to authenticated
  using (seller_id = (select private.current_seller_id()));

create policy stores_owner_insert on public.stores
  for insert to authenticated
  with check (seller_id = (select private.current_seller_id()));

create policy stores_owner_update on public.stores
  for update to authenticated
  using (seller_id = (select private.current_seller_id()))
  with check (seller_id = (select private.current_seller_id()));

drop policy if exists products_owner_all on public.products;
drop policy if exists products_anon_active_select on public.products;

create policy products_owner_all on public.products
  for all to authenticated
  using (private.is_store_owner(store_id))
  with check (private.is_store_owner(store_id));

create policy products_anon_active_select on public.products
  for select to anon
  using (is_active = true and private.is_store_active(store_id));

drop policy if exists orders_owner_select on public.orders;
drop policy if exists orders_owner_update on public.orders;
drop policy if exists orders_anon_insert on public.orders;
drop policy if exists orders_tracking_token_select on public.orders;

create policy orders_owner_select on public.orders
  for select to authenticated
  using (private.is_store_owner(store_id));

create policy orders_owner_update on public.orders
  for update to authenticated
  using (private.is_store_owner(store_id))
  with check (private.is_store_owner(store_id));

create policy orders_anon_insert on public.orders
  for insert to anon
  with check (
    private.is_store_active(store_id)
    and order_status = 'new'
    and payment_status in ('unpaid', 'pay_at_pickup')
    and checkout_retry_count = 0
  );

create policy orders_tracking_token_select on public.orders
  for select to anon, authenticated
  using (private.has_valid_order_tracking_token(id));

drop policy if exists order_items_owner_select on public.order_items;

create policy order_items_owner_select on public.order_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and private.is_store_owner(o.store_id)
    )
  );

drop policy if exists order_tracking_tokens_owner_select on public.order_tracking_tokens;
drop policy if exists order_tracking_tokens_token_select on public.order_tracking_tokens;

create policy order_tracking_tokens_owner_select on public.order_tracking_tokens
  for select to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_tracking_tokens.order_id
        and private.is_store_owner(o.store_id)
    )
  );

create policy order_tracking_tokens_token_select on public.order_tracking_tokens
  for select to anon, authenticated
  using (
    expires_at > now()
    and token = nullif(current_setting('stoop.order_tracking_token', true), '')
  );

drop policy if exists subscribers_owner_select on public.subscribers;
drop policy if exists subscribers_anon_insert on public.subscribers;

create policy subscribers_owner_select on public.subscribers
  for select to authenticated
  using (private.is_store_owner(store_id));

create policy subscribers_anon_insert on public.subscribers
  for insert to anon
  with check (private.is_store_active(store_id));

drop policy if exists qr_codes_owner_all on public.qr_codes;

create policy qr_codes_owner_all on public.qr_codes
  for all to authenticated
  using (private.is_store_owner(store_id))
  with check (private.is_store_owner(store_id));

drop policy if exists buildings_anon_public_select on public.buildings;
drop policy if exists buildings_member_select on public.buildings;

create policy buildings_anon_public_select on public.buildings
  for select to anon
  using (private.building_has_active_membership(id));

create policy buildings_member_select on public.buildings
  for select to authenticated
  using (
    exists (
      select 1
      from public.building_memberships m
      join public.stores st on st.id = m.store_id
      where m.building_id = buildings.id
        and private.is_store_owner(st.id)
    )
  );

drop policy if exists building_memberships_owner_select on public.building_memberships;
drop policy if exists building_memberships_owner_update on public.building_memberships;

create policy building_memberships_owner_select on public.building_memberships
  for select to authenticated
  using (private.is_store_owner(store_id));

create policy building_memberships_owner_update on public.building_memberships
  for update to authenticated
  using (private.is_store_owner(store_id))
  with check (private.is_store_owner(store_id));

grant select (
  id,
  store_id,
  customer_name,
  total_cents,
  currency,
  payment_mode,
  payment_status,
  order_status,
  pickup_time,
  pickup_window,
  created_at,
  updated_at
) on public.orders to anon;
grant select (token, order_id, expires_at) on public.order_tracking_tokens to anon;

drop function if exists public.get_order_by_token(text);

create function public.get_order_by_token(p_token text)
returns table (
  id uuid,
  store_id uuid,
  customer_name text,
  total_cents integer,
  currency char(3),
  payment_mode public.payment_mode,
  payment_status public.payment_status,
  order_status public.order_status,
  pickup_time timestamptz,
  pickup_window text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('stoop.order_tracking_token', p_token, true);

  return query
    select
      o.id,
      o.store_id,
      o.customer_name,
      o.total_cents,
      o.currency,
      o.payment_mode,
      o.payment_status,
      o.order_status,
      o.pickup_time,
      o.pickup_window,
      o.created_at,
      o.updated_at
    from public.orders o
    join public.order_tracking_tokens t on t.order_id = o.id
    where t.token = p_token
      and t.expires_at > now();
end;
$$;

revoke all on function public.get_order_by_token(text) from public;
grant execute on function public.get_order_by_token(text) to anon, authenticated;

drop function if exists public.current_seller_id();
drop function if exists public.is_store_owner(uuid);
drop function if exists public.is_store_active(uuid);
drop function if exists public.building_has_active_membership(uuid);
