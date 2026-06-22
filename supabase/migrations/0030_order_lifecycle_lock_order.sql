-- Phase 6 forward migration for environments that already applied 0028 before the
-- deterministic product-lock ordering fix. Replaces place_order only; function signature and
-- generated TypeScript types are unchanged.

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
    -- Lock finite-stock product rows in a deterministic order to reduce deadlock risk when
    -- concurrent carts overlap on the same product set but arrive in different client order.
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

  v_payment_status := case
    when p_payment_mode = 'online' then 'unpaid'::public.payment_status
    else 'pay_at_pickup'::public.payment_status
  end;

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
