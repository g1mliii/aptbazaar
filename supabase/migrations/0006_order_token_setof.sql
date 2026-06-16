-- get_order_by_token returns 0 or 1 rows. Declaring it RETURNS public.orders (a single
-- composite) makes a no-match call return a row of NULLs; SETOF makes it an empty result,
-- which is what the tracking page expects. Return-type change requires drop + create.

drop function if exists public.get_order_by_token(text);

create function public.get_order_by_token(p_token text)
returns setof public.orders
language sql
stable
security definer
set search_path = public
as $$
  select o.*
  from public.orders o
  join public.order_tracking_tokens t on t.order_id = o.id
  where t.token = p_token
    and t.expires_at > now();
$$;

grant execute on function public.get_order_by_token(text) to anon, authenticated;
