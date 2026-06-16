-- Phase 2 follow-up: scale-oriented indexes and RLS helper tightening.
-- Existing Supabase projects that already recorded 0002-0011 need this new
-- migration version; fresh databases also get the same shape from the earlier
-- migrations, so every operation here is idempotent.

create index if not exists stores_seller_created_idx
  on public.stores (seller_id, created_at desc);

create index if not exists products_store_active_created_idx
  on public.products (store_id, is_active, created_at desc);

create index if not exists orders_store_created_idx
  on public.orders (store_id, created_at desc);
create index if not exists orders_store_status_created_idx
  on public.orders (store_id, order_status, created_at desc);
create unique index if not exists orders_stripe_checkout_session_id_key
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create unique index if not exists orders_stripe_payment_intent_id_key
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists order_items_product_id_idx
  on public.order_items (product_id);

create index if not exists subscribers_store_created_idx
  on public.subscribers (store_id, created_at desc);
create index if not exists subscribers_store_active_drop_idx
  on public.subscribers (store_id, created_at desc)
  where verified_at is not null and unsubscribed_at is null;

create index if not exists qr_codes_store_type_created_idx
  on public.qr_codes (store_id, qr_type, created_at desc);

create index if not exists building_memberships_building_status_idx
  on public.building_memberships (building_id, status);

create index if not exists stripe_events_unprocessed_received_idx
  on public.stripe_events (received_at)
  where processed_at is null;
create index if not exists stripe_events_type_received_idx
  on public.stripe_events (type, received_at desc);

create index if not exists audit_log_actor_created_idx
  on public.audit_log (actor_type, actor_id, created_at desc);
create index if not exists audit_log_target_created_idx
  on public.audit_log (target_table, target_id, created_at desc)
  where target_table is not null and target_id is not null;

drop index if exists public.stores_seller_id_idx;
drop index if exists public.products_store_id_idx;
drop index if exists public.orders_store_id_idx;
drop index if exists public.subscribers_store_id_idx;
drop index if exists public.qr_codes_store_id_idx;
drop index if exists public.building_memberships_building_id_idx;

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
