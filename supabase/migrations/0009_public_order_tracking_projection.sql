-- Code-review follow-up to 0006. The public tracking token is a capability, but
-- it should still return only the fields the tracking page needs, not the raw
-- orders row with Stripe/idempotency internals.

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
language sql
stable
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.get_order_by_token(text) to anon, authenticated;
