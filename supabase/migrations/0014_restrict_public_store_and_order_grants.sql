-- Phase 2 review follow-up: public storefront access should be column-scoped,
-- and order creation should flow through the server action/service role path.

-- Active stores are public, but not every store column is public. In particular,
-- pickup_private_note can contain post-order pickup details or unit numbers.
revoke select on public.stores from anon;
grant select (
  id,
  slug,
  name,
  category,
  description,
  logo_url,
  is_active,
  visibility,
  pickup_method,
  pickup_window_label,
  pickup_public_note,
  accept_pay_at_pickup,
  order_count_week,
  created_at,
  updated_at
) on public.stores to anon;

-- The public checkout path writes orders through a server action so validation,
-- idempotency, rate limits, and Stripe setup cannot be bypassed with the anon key.
revoke insert on public.orders from anon;
drop policy if exists orders_anon_insert on public.orders;
