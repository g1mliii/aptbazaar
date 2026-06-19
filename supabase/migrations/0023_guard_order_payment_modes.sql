-- Phase 4 forward fix: keep order placement aligned with the seller's enabled payment path.
--
-- 0020-0022 define place_order, but environments may already have applied those migrations.
-- This trigger is intentionally forward-only: it guards every new order row, including rows
-- inserted through the service-role RPC, without rewriting migration history.

create or replace function private.enforce_order_payment_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_is_active boolean := false;
  v_accept_pay_at_pickup boolean := false;
begin
  select st.is_active, st.accept_pay_at_pickup
    into v_store_is_active, v_accept_pay_at_pickup
  from public.stores st
  where st.id = new.store_id;

  if not coalesce(v_store_is_active, false) then
    raise exception 'store_not_taking_orders' using errcode = 'STP02';
  end if;

  -- Phase 4 has no Stripe Checkout handoff yet, so online orders are not a valid insert path.
  -- Phase 5 should update this guard when Stripe-owned Checkout creation is wired.
  if new.payment_mode = 'online'
    or (
      new.payment_mode = 'pay_at_pickup'
      and not coalesce(v_accept_pay_at_pickup, false)
    )
  then
    raise exception 'payment_mode_unavailable' using errcode = 'STP06';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_order_payment_mode() from public;

drop trigger if exists orders_enforce_payment_mode on public.orders;
create trigger orders_enforce_payment_mode
  before insert or update of store_id, payment_mode on public.orders
  for each row
  execute function private.enforce_order_payment_mode();
