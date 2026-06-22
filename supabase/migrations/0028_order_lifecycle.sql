-- Phase 6: order lifecycle — status machine, inventory enforcement, per-order notes, and the
-- refund-lifecycle in-between states. One migration so a partial apply can't leave the status RPC
-- live without inventory support. After applying to the linked project, regen types
-- (npm run supabase:gen-types) so the new RPCs/columns land in lib/supabase/database.types.ts.
--
-- BEHAVIOR CHANGE (§1d): the order_count_week decrement that mark_order_refunded did directly
-- (migration 0026) now moves under the orders.stock_restored exactly-once marker. A paid order
-- that is cancelled defers its stock + count restore to the confirmed charge.refunded event, so a
-- refund that ends in refund_failed never leaks stock/count back. The payments integration test
-- covers the no-double-decrement guarantee.

-- ---------------------------------------------------------------------------
-- 1a. Enum values FIRST. A newly added enum value cannot be used in executed DML in the same
-- transaction it was added (PG rule). This migration only adds values and (re)creates functions —
-- function bodies are deferred text, not executed — and adds columns with no DML referencing the
-- new values, so a single migration is safe. Do NOT add any backfill that touches these values; if
-- a future edit needs that, split these ADD VALUE statements into their own earlier migration.
-- ---------------------------------------------------------------------------

alter type public.payment_status add value if not exists 'refund_pending';
alter type public.payment_status add value if not exists 'refund_failed';

-- ---------------------------------------------------------------------------
-- 1a. Columns. notes (the customer note) already exists; add the two seller-authored notes and the
-- exactly-once stock-restore marker. The existing orders_owner_update policy (0002) already lets
-- the owner write these columns, so no notes policy change is needed.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists notes_seller text,
  add column if not exists notes_shared text,
  add column if not exists stock_restored boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1d. Exactly-once stock + count restore. Gated on orders.stock_restored so restore happens once
-- across path ordering (unpaid cancel vs paid cancel→refund) and webhook redelivery. NULL
-- qty_available means unlimited and is left untouched.
-- ---------------------------------------------------------------------------

create or replace function private.restore_order_stock(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
begin
  -- Win-the-flip marker: only the caller that flips false→true does the restore.
  update public.orders
  set stock_restored = true
  where id = p_order_id and stock_restored = false
  returning store_id into v_store_id;

  if v_store_id is null then
    return false; -- already restored (other path or redelivery)
  end if;

  update public.products p
  set qty_available = p.qty_available + oi.quantity
  from public.order_items oi
  where oi.order_id = p_order_id
    and oi.product_id = p.id
    and p.qty_available is not null;

  update public.stores
  set order_count_week = greatest(order_count_week - 1, 0)
  where id = v_store_id;

  return true;
end;
$$;

revoke all on function private.restore_order_stock(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b. transition_order_status — the seller-driven order status machine.
-- Pass the user id explicitly: the secret client has no JWT, mirroring place_order /
-- mark_order_refunded. Returns the resulting status and the prior status so the action can detect a
-- same-state no-op (the dedupe primitive for emails/SSE).
-- ---------------------------------------------------------------------------

create or replace function public.transition_order_status(
  p_order_id uuid,
  p_seller_user_id uuid,
  p_to public.order_status
)
returns table (order_status public.order_status, from_status public.order_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.order_status;
  v_store_id uuid;
  v_payment_mode public.payment_mode;
  v_payment_status public.payment_status;
  v_owner boolean;
begin
  select o.order_status, o.store_id, o.payment_mode, o.payment_status
    into v_from, v_store_id, v_payment_mode, v_payment_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if v_from is null then
    raise exception 'order not found' using errcode = 'OD403';
  end if;

  -- Ownership: join stores→sellers, confirm this seller owns the order's store.
  select exists (
    select 1
    from public.stores st
    join public.sellers se on se.id = st.seller_id
    where st.id = v_store_id
      and se.user_id = p_seller_user_id
  ) into v_owner;

  if not v_owner then
    raise exception 'not the order owner' using errcode = 'OD403';
  end if;

  -- Same-state = idempotent no-op (the dedupe primitive: action skips email/publish when from=to).
  if v_from = p_to then
    order_status := v_from;
    from_status := v_from;
    return next;
    return;
  end if;

  -- State machine. complete / cancelled are terminal.
  if not (
    (v_from = 'new'       and p_to in ('accepted', 'cancelled')) or
    (v_from = 'accepted'  and p_to in ('preparing', 'cancelled')) or
    (v_from = 'preparing' and p_to in ('ready', 'cancelled')) or
    (v_from = 'ready'     and p_to in ('complete', 'cancelled'))
  ) then
    raise exception 'invalid_transition' using errcode = 'OD409';
  end if;

  update public.orders
  set order_status = p_to
  where id = p_order_id;

  -- On cancel, restore stock + count immediately UNLESS an ONLINE order has money settled or in
  -- flight — that path defers its restore to mark_order_refunded on the confirmed charge.refunded,
  -- so a refund that ends in refund_failed never leaks stock back. A pay-at-pickup order has no
  -- Stripe refund (mark_order_refunded never fires for it), so even when it's marked 'paid' the
  -- cancel must restore here or its stock/count would leak forever.
  if p_to = 'cancelled'
     and not (
       v_payment_mode = 'online'
       and v_payment_status in ('paid', 'refund_pending', 'refunded')
     ) then
    perform private.restore_order_stock(p_order_id);
  end if;

  insert into public.audit_log (actor_type, actor_id, action, target_table, target_id, payload_jsonb)
  values (
    'seller',
    p_seller_user_id::text,
    'order.status_changed',
    'orders',
    p_order_id::text,
    jsonb_build_object('from', v_from, 'to', p_to)
  );

  order_status := p_to;
  from_status := v_from;
  return next;
end;
$$;

revoke all on function public.transition_order_status(uuid, uuid, public.order_status)
  from public, anon, authenticated;
grant execute on function public.transition_order_status(uuid, uuid, public.order_status)
  to service_role;

-- ---------------------------------------------------------------------------
-- 1e. mark_pay_at_pickup_paid — the seller flips a pay-at-pickup order to paid when cash/e-transfer
-- changes hands. Pinned to service_role only (NOT the blanket RLS UPDATE), so a seller can never
-- self-declare an ONLINE order paid — Stripe owns that transition (hard invariant 5).
-- ---------------------------------------------------------------------------

create or replace function public.mark_pay_at_pickup_paid(
  p_order_id uuid,
  p_seller_user_id uuid
)
returns public.payment_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_mode public.payment_mode;
  v_payment_status public.payment_status;
  v_store_id uuid;
  v_owner boolean;
begin
  select o.payment_mode, o.payment_status, o.store_id
    into v_payment_mode, v_payment_status, v_store_id
  from public.orders o
  where o.id = p_order_id
  for update;

  if v_store_id is null then
    raise exception 'order not found' using errcode = 'OD403';
  end if;

  select exists (
    select 1
    from public.stores st
    join public.sellers se on se.id = st.seller_id
    where st.id = v_store_id
      and se.user_id = p_seller_user_id
  ) into v_owner;

  if not v_owner then
    raise exception 'not the order owner' using errcode = 'OD403';
  end if;

  -- Stripe owns online money. This RPC only marks pay-at-pickup cash received.
  if v_payment_mode <> 'pay_at_pickup' then
    raise exception 'not a pay-at-pickup order' using errcode = 'OD409';
  end if;

  -- Idempotent: only the pay_at_pickup→paid edge does work + audits; re-clicks are a no-op.
  if v_payment_status = 'pay_at_pickup' then
    update public.orders
    set payment_status = 'paid'
    where id = p_order_id;

    insert into public.audit_log (actor_type, actor_id, action, target_table, target_id, payload_jsonb)
    values (
      'seller',
      p_seller_user_id::text,
      'order.marked_paid',
      'orders',
      p_order_id::text,
      jsonb_build_object('payment_mode', v_payment_mode)
    );

    return 'paid';
  end if;

  return v_payment_status;
end;
$$;

revoke all on function public.mark_pay_at_pickup_paid(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_pay_at_pickup_paid(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 1d (cont). mark_order_refunded — re-emitted so the order_count_week decrement moves UNDER the
-- stock_restored marker (was a direct decrement in 0026). Now the confirmed full refund flips
-- payment_status → refunded AND restores stock + count exactly once. Still idempotent: a redelivery
-- finds payment_status already 'refunded', changes nothing, returns null. A paid order cancelled
-- first deferred its restore to here, so this is the single restore point for the refund path.
-- ---------------------------------------------------------------------------

create or replace function public.mark_order_refunded(
  p_order_id uuid,
  p_charge_id text,
  p_amount_refunded bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select o.id
    into v_order_id
  from public.orders o
  where o.id = p_order_id
    and o.payment_status is distinct from 'refunded'
  for update;

  if v_order_id is null then
    return null;
  end if;

  update public.orders
  set payment_status = 'refunded'
  where id = v_order_id;

  -- Gated restore: exactly-once across the paid-cancel→refund path and webhook redelivery.
  perform private.restore_order_stock(v_order_id);

  insert into public.audit_log (actor_type, action, target_table, target_id, payload_jsonb)
  values (
    'system',
    'order.refunded',
    'orders',
    v_order_id::text,
    jsonb_build_object('stripe_charge_id', p_charge_id, 'amount_refunded', p_amount_refunded)
  );

  return v_order_id;
end;
$$;

revoke all on function public.mark_order_refunded(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.mark_order_refunded(uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 1c. place_order — re-emitted from 0024 with the inventory fix. Two changes only:
--   (1) priced_items locks rows `for update of p` (was `for share of p`) in deterministic product
--       id order so concurrent multi-item carts serialize instead of deadlocking or overselling, and
--   (2) after the line-items insert, decrement qty_available for each finite-qty product.
-- NULL qty_available (unlimited) is untouched. Everything else is verbatim from 0024.
-- ---------------------------------------------------------------------------

create or replace function public.place_order(
  p_store_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone_e164 text,
  p_payment_mode public.payment_mode,
  p_pickup_window text,
  p_notes text,
  p_idempotency_key text,
  p_request_hash text,
  p_token text,
  p_token_ttl_hours integer,
  p_items jsonb
)
returns table (order_id uuid, token text, total_cents integer, replayed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_order_id uuid;
  v_existing_request_hash text;
  v_existing_total_cents integer;
  v_existing_token text;
  v_order_id uuid;
  v_total integer := 0;
  v_total_bigint bigint := 0;
  v_currency char(3) := 'CAD';
  v_currency_count integer := 0;
  v_payment_status public.payment_status;
  v_raw_count integer := 0;
  v_aggregated_count integer := 0;
  v_available_count integer := 0;
  v_bad_quantity_count integer := 0;
  v_oversized_quantity_count integer := 0;
  v_insufficient_count integer := 0;
  v_store_is_active boolean := false;
  v_accept_pay_at_pickup boolean := false;
  v_seller_id uuid;
  v_charges_enabled boolean := false;
begin
  -- 1. Idempotency replay. Look up by the per-store unique key first, with an explicit
  -- projection so the hot RPC never selects the full PII-bearing order row.
  select o.id, o.request_hash, o.total_cents
    into v_existing_order_id, v_existing_request_hash, v_existing_total_cents
  from public.orders o
  where o.store_id = p_store_id and o.idempotency_key = p_idempotency_key;

  if v_existing_order_id is not null then
    if v_existing_request_hash = p_request_hash then
      -- Genuine retry: hand back the order's existing token, not the freshly minted one.
      select t.token into v_existing_token
      from public.order_tracking_tokens t
      where t.order_id = v_existing_order_id
      order by t.created_at asc
      limit 1;

      order_id := v_existing_order_id;
      token := v_existing_token;
      total_cents := v_existing_total_cents;
      replayed := true;
      return next;
      return;
    end if;

    -- Same key, different body: refuse and reveal nothing about the original order.
    raise exception 'idempotency_key_reused_with_different_body'
      using errcode = 'STP01';
  end if;

  -- 2. Store must be live and the requested payment path must be available. Pay-at-pickup needs
  -- accept_pay_at_pickup; online (Phase 5) needs the seller's connected account to take charges.
  select st.is_active, st.accept_pay_at_pickup, st.seller_id
    into v_store_is_active, v_accept_pay_at_pickup, v_seller_id
  from public.stores st
  where st.id = p_store_id;

  if not coalesce(v_store_is_active, false) then
    raise exception 'store_not_taking_orders' using errcode = 'STP02';
  end if;

  if p_payment_mode = 'online' then
    select coalesce(ca.charges_enabled, false)
      into v_charges_enabled
    from public.connected_accounts ca
    where ca.seller_id = v_seller_id;

    if not coalesce(v_charges_enabled, false) then
      raise exception 'payment_mode_unavailable' using errcode = 'STP06';
    end if;
  elsif p_payment_mode = 'pay_at_pickup'
    and not coalesce(v_accept_pay_at_pickup, false)
  then
    raise exception 'payment_mode_unavailable' using errcode = 'STP06';
  end if;

  -- 3. Recompute the total from DB prices and snapshot each line. Products must belong to
  -- this store and be active; quantities must fit any finite qty_available. The cart is capped
  -- to keep malformed service-role calls from turning the placement RPC into a JSON parse sink.
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 100
  then
    raise exception 'invalid_cart' using errcode = 'STP03';
  end if;

  with raw_items as (
    select item.product_id, item.quantity
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
  )
  select
    count(*)::integer,
    count(*) filter (
      where product_id is null or quantity is null or quantity <= 0
    )::integer
    into v_raw_count, v_bad_quantity_count
  from raw_items;

  if v_raw_count = 0 or v_bad_quantity_count > 0 then
    raise exception 'invalid_quantity' using errcode = 'STP03';
  end if;

  with raw_items as (
    select item.product_id, item.quantity
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
  ),
  aggregated_items as (
    select product_id, sum(quantity)::bigint as quantity
    from raw_items
    group by product_id
  ),
  priced_items as materialized (
    select
      p.id as product_id,
      ai.quantity,
      p.price_cents,
      p.currency,
      p.qty_available
    from aggregated_items ai
    join public.products p on p.id = ai.product_id
    where p.store_id = p_store_id
      and p.is_active = true
    -- `for update of p` (was `for share`): serialize concurrent placements on the same product so
    -- two readers can't both pass the STP05 check and oversell. Lock by product id to reduce
    -- deadlocks when two carts contain the same finite-stock products in different client order.
    order by p.id
    for update of p
  )
  select
    (select count(*)::integer from aggregated_items),
    count(*)::integer,
    coalesce(sum(price_cents::bigint * quantity::bigint), 0),
    coalesce(min(currency), 'CAD'::char(3)),
    count(distinct currency)::integer,
    count(*) filter (where quantity > 2147483647)::integer,
    count(*) filter (
      where qty_available is not null and quantity > qty_available
    )::integer
    into
      v_aggregated_count,
      v_available_count,
      v_total_bigint,
      v_currency,
      v_currency_count,
      v_oversized_quantity_count,
      v_insufficient_count
  from priced_items;

  -- A same-key duplicate submit can wait behind the winner's product locks. Once the winner
  -- commits, this transaction sees the existing order; replay it before stock-derived checks would
  -- turn the duplicate into STP05.
  select o.id, o.request_hash, o.total_cents
    into v_existing_order_id, v_existing_request_hash, v_existing_total_cents
  from public.orders o
  where o.store_id = p_store_id and o.idempotency_key = p_idempotency_key;

  if v_existing_order_id is not null then
    if v_existing_request_hash = p_request_hash then
      select t.token into v_existing_token
      from public.order_tracking_tokens t
      where t.order_id = v_existing_order_id
      order by t.created_at asc
      limit 1;

      order_id := v_existing_order_id;
      token := v_existing_token;
      total_cents := v_existing_total_cents;
      replayed := true;
      return next;
      return;
    end if;

    raise exception 'idempotency_key_reused_with_different_body'
      using errcode = 'STP01';
  end if;

  if v_available_count <> v_aggregated_count then
    raise exception 'product_unavailable' using errcode = 'STP04';
  end if;

  if v_insufficient_count > 0 then
    raise exception 'insufficient_quantity' using errcode = 'STP05';
  end if;

  if v_currency_count > 1
    or v_oversized_quantity_count > 0
    or v_total_bigint > 2147483647
  then
    raise exception 'invalid_cart' using errcode = 'STP03';
  end if;

  v_total := v_total_bigint::integer;

  -- 4. Payment status follows the mode. Stripe owns the transition to 'paid' (invariant 5);
  -- online orders start 'unpaid' and the Phase 5 webhook flips them.
  v_payment_status := case
    when p_payment_mode = 'online' then 'unpaid'::public.payment_status
    else 'pay_at_pickup'::public.payment_status
  end;

  -- 5. Insert the order, its items, and the tracking token; bump the social-proof counter.
  -- The step-1 lookup and this insert are not atomic, so two concurrent requests with the same
  -- (store_id, idempotency_key) can both miss step 1 and race here. The UNIQUE constraint lets one
  -- win; the loser catches unique_violation and replays instead of surfacing a generic error — the
  -- same outcome a sequential retry gets.
  begin
    insert into public.orders (
      store_id, customer_name, customer_email, customer_phone_e164,
      total_cents, currency, payment_mode, payment_status, order_status,
      pickup_window, notes, idempotency_key, request_hash
    )
    values (
      p_store_id, p_customer_name, p_customer_email, p_customer_phone_e164,
      v_total, v_currency, p_payment_mode, v_payment_status, 'new',
      p_pickup_window, p_notes, p_idempotency_key, p_request_hash
    )
    returning id into v_order_id;
  exception when unique_violation then
    select o.id, o.request_hash, o.total_cents
      into v_existing_order_id, v_existing_request_hash, v_existing_total_cents
    from public.orders o
    where o.store_id = p_store_id and o.idempotency_key = p_idempotency_key;

    -- Same key, different body even under the race: refuse and reveal nothing (STP01 defense).
    if v_existing_request_hash is distinct from p_request_hash then
      raise exception 'idempotency_key_reused_with_different_body'
        using errcode = 'STP01';
    end if;

    select t.token into v_existing_token
    from public.order_tracking_tokens t
    where t.order_id = v_existing_order_id
    order by t.created_at asc
    limit 1;

    order_id := v_existing_order_id;
    token := v_existing_token;
    total_cents := v_existing_total_cents;
    replayed := true;
    return next;
    return;
  end;

  with raw_items as (
    select item.product_id, item.quantity
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
  ),
  aggregated_items as (
    select product_id, sum(quantity)::bigint as quantity
    from raw_items
    group by product_id
  )
  insert into public.order_items (
    order_id, product_id, name_at_purchase, quantity, price_cents_at_purchase
  )
  select v_order_id, p.id, p.name, ai.quantity::integer, p.price_cents
  from aggregated_items ai
  join public.products p on p.id = ai.product_id
  where p.store_id = p_store_id
    and p.is_active = true
  order by p.id;

  -- Inventory decrement: the rows are already locked `for update` above, so this is the
  -- serialized write that actually consumes stock. NULL qty_available (unlimited) is untouched.
  with raw_items as (
    select item.product_id, item.quantity
    from jsonb_to_recordset(p_items) as item(product_id uuid, quantity integer)
  ),
  aggregated_items as (
    select product_id, sum(quantity)::bigint as quantity
    from raw_items
    group by product_id
  )
  update public.products p
  set qty_available = p.qty_available - ai.quantity::integer
  from aggregated_items ai
  where ai.product_id = p.id
    and p.store_id = p_store_id
    and p.qty_available is not null;

  insert into public.order_tracking_tokens (token, order_id, expires_at)
  values (p_token, v_order_id, now() + make_interval(hours => p_token_ttl_hours));

  update public.stores
  set order_count_week = order_count_week + 1
  where id = p_store_id;

  order_id := v_order_id;
  token := p_token;
  total_cents := v_total;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.place_order(
  uuid, text, text, text, public.payment_mode, text, text, text, text, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.place_order(
  uuid, text, text, text, public.payment_mode, text, text, text, text, text, integer, jsonb
) to service_role;
