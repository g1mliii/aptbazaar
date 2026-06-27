-- Order throttling + free settlement. Two seller-facing levers to stop the "more orders than I can
-- fill" flood, plus the server side of free/giveaway items:
--   * stores.orders_per_day_limit  — accept N orders/day, then the storefront shows "fully booked
--     for today" and reopens tomorrow. "Today" is a fixed America/Toronto calendar day for v1
--     (CAD-only, local-Canada focus); a per-store timezone is a post-MVP refinement.
--   * products.max_per_order        — cap how many of one item a single order can grab (so a popular
--     drop or a giveaway isn't cleaned out by one person).
-- The daily counter (orders_today / orders_today_date) is reset lazily inside place_order on the
-- first order of a new day, so no cron is needed. The cap is enforced by one atomic store update at
-- the end of the transaction so uncapped stores are not serialized behind a long store-row lock. It
-- is intentionally NOT decremented on
-- cancel/refund (0028/0025 only touch order_count_week): a cancelled order still consumed a slot for
-- the day. Additive + nullable per the forward-only policy; existing rows keep NULL = unlimited.
-- No RLS policy change — stores_owner_all / stores_anon_active_select and products_owner_all already
-- govern these tables. 0035 narrowed anon's stores access to a column grant, so this migration adds
-- only the new public capacity columns needed by the storefront.

alter table public.stores
  add column if not exists orders_per_day_limit integer
    check (orders_per_day_limit is null or orders_per_day_limit > 0),
  add column if not exists orders_today integer not null default 0,
  add column if not exists orders_today_date date;

comment on column public.stores.orders_per_day_limit is
  'Max orders accepted per America/Toronto calendar day (NULL = unlimited). Enforced in place_order (STP07).';

grant select (orders_per_day_limit, orders_today, orders_today_date)
  on public.stores to anon;

alter table public.products
  add column if not exists max_per_order integer
    check (max_per_order is null or max_per_order > 0);

comment on column public.products.max_per_order is
  'Max quantity of this item allowed in one order (NULL = no per-order cap). Enforced in place_order (STP08).';

-- Rewrite place_order (carries forward 0031's idempotent last-unit replay) to add: the daily-cap gate
-- (STP07), the per-order quantity cap (STP08), free settlement (total 0 -> payment_status 'paid',
-- skipping the online/pay-at-pickup setup gates), and the lazy daily-counter bump. Signature and
-- returned columns are unchanged, so generated TypeScript types are unaffected.
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
  v_over_per_order_count integer := 0;
  v_store_is_active boolean := false;
  v_accept_pay_at_pickup boolean := false;
  v_seller_id uuid;
  v_charges_enabled boolean := false;
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_orders_per_day_limit integer;
  v_orders_today integer := 0;
  v_orders_today_date date;
  v_effective_today integer := 0;
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

  select st.is_active, st.accept_pay_at_pickup, st.seller_id,
         st.orders_per_day_limit, st.orders_today, st.orders_today_date
    into v_store_is_active, v_accept_pay_at_pickup, v_seller_id,
         v_orders_per_day_limit, v_orders_today, v_orders_today_date
  from public.stores st
  where st.id = p_store_id;

  if not coalesce(v_store_is_active, false) then
    raise exception 'store_not_taking_orders' using errcode = 'STP02';
  end if;

  -- Fast advisory capacity gate. The authoritative concurrent check is the final atomic UPDATE
  -- below; this early branch just avoids doing checkout/product work when the store is already full.
  -- A stored date older than today means the prior day's count is stale -> treat as 0.
  if v_orders_per_day_limit is not null then
    v_effective_today := case
      when v_orders_today_date = v_today then v_orders_today
      else 0
    end;
    if v_effective_today >= v_orders_per_day_limit then
      raise exception 'capacity_reached' using errcode = 'STP07';
    end if;
  end if;

  -- Free orders (total 0) skip these payment-setup gates entirely — nothing is owed, so neither a
  -- connected Stripe account nor pay-at-pickup needs to be enabled. The 'free' mode falls through.
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
      p.qty_available,
      p.max_per_order
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
    )::integer,
    count(*) filter (
      where max_per_order is not null and quantity > max_per_order
    )::integer
    into
      v_aggregated_count,
      v_available_count,
      v_total_bigint,
      v_currency,
      v_currency_count,
      v_oversized_quantity_count,
      v_insufficient_count,
      v_over_per_order_count
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

  if v_over_per_order_count > 0 then
    raise exception 'over_per_order_limit' using errcode = 'STP08';
  end if;

  if v_currency_count > 1
    or v_oversized_quantity_count > 0
    or v_total_bigint > 2147483647
  then
    raise exception 'invalid_cart' using errcode = 'STP03';
  end if;

  v_total := v_total_bigint::integer;

  -- 'free' mode is only legitimate for a genuinely free cart; reject it for anything with a price so
  -- it can't be used to skip payment on paid items.
  if p_payment_mode = 'free' and v_total <> 0 then
    raise exception 'invalid_cart' using errcode = 'STP03';
  end if;

  v_payment_status := case
    when v_total = 0 then 'paid'::public.payment_status
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

  -- Bump both counters and enforce the daily cap in one atomic row update. This is the only
  -- authoritative capacity decision: if a competing transaction filled the final slot while this
  -- order was doing product/payment work, the UPDATE affects zero rows and the exception rolls the
  -- order, line items, stock decrement, and token back together. Free orders count toward the cap.
  update public.stores
  set order_count_week = order_count_week + 1,
      orders_today = case when orders_today_date = v_today then orders_today + 1 else 1 end,
      orders_today_date = v_today
  where id = p_store_id
    and (
      orders_per_day_limit is null
      or (
        case
          when orders_today_date = v_today then orders_today
          else 0
        end
      ) < orders_per_day_limit
    );

  if not found then
    raise exception 'capacity_reached' using errcode = 'STP07';
  end if;

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
