-- Phase 4.4: atomic, idempotent customer order placement.
--
-- Anon has an INSERT policy on `orders` but NOT on `order_items` or
-- `order_tracking_tokens`, and the order total must never be trusted from the client.
-- So placement runs through this one SECURITY DEFINER function (same shape as
-- create_store_quickstart, migration 0015): one transaction, server-recomputed prices,
-- snapshotted line items, a minted tracking token, and the order_count_week bump.
--
-- Called server-side only, via the secret/service-role client in lib/actions/orders.ts.
--
-- Idempotency: UNIQUE(store_id, idempotency_key) guards the row. A legitimate retry
-- (refresh, double-tap, network retry) carries the same key AND the same request_hash, so
-- we return the existing tracking token. A reused key with a DIFFERENT body raises STP01,
-- which the action maps to a 409 — and we never leak the original order's token to a
-- guessed key (token-exfiltration defense from the plan's 4.4 step 3).

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

  -- 2. Store must be live and the requested payment path must be available. Phase 4 supports
  -- pay-at-pickup only; Phase 5 will extend this guard when Stripe Checkout is wired.
  select st.is_active, st.accept_pay_at_pickup
    into v_store_is_active, v_accept_pay_at_pickup
  from public.stores st
  where st.id = p_store_id;

  if not coalesce(v_store_is_active, false) then
    raise exception 'store_not_taking_orders' using errcode = 'STP02';
  end if;

  if p_payment_mode = 'online'
    or (
      p_payment_mode = 'pay_at_pickup'
      and not coalesce(v_accept_pay_at_pickup, false)
    )
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
    for share of p
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

-- Server-only: the secret client (service_role) is the sole caller. Anon places orders
-- through the action, never by calling this directly.
revoke all on function public.place_order(
  uuid, text, text, text, public.payment_mode, text, text, text, text, text, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.place_order(
  uuid, text, text, text, public.payment_mode, text, text, text, text, text, integer, jsonb
) to service_role;
