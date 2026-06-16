-- Phase 2 follow-up: clear Supabase RLS performance advisories.
-- Fixes:
-- - auth_rls_initplan on order_tracking_tokens_token_select by wrapping current_setting()
--   in a SELECT init plan.
-- - multiple_permissive_policies on authenticated SELECT for orders and
--   order_tracking_tokens by merging owner + tracking-token access into one
--   authenticated policy per table.

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
      and t.token = nullif((select current_setting('stoop.order_tracking_token', true)), '')
  );
$$;

drop policy if exists orders_owner_select on public.orders;
drop policy if exists orders_tracking_token_select on public.orders;
drop policy if exists orders_authenticated_select on public.orders;
drop policy if exists orders_anon_tracking_token_select on public.orders;

create policy orders_authenticated_select on public.orders
  for select to authenticated
  using (
    private.is_store_owner(store_id)
    or private.has_valid_order_tracking_token(id)
  );

create policy orders_anon_tracking_token_select on public.orders
  for select to anon
  using (private.has_valid_order_tracking_token(id));

drop policy if exists order_tracking_tokens_owner_select on public.order_tracking_tokens;
drop policy if exists order_tracking_tokens_token_select on public.order_tracking_tokens;
drop policy if exists order_tracking_tokens_authenticated_select on public.order_tracking_tokens;
drop policy if exists order_tracking_tokens_anon_token_select on public.order_tracking_tokens;

create policy order_tracking_tokens_authenticated_select on public.order_tracking_tokens
  for select to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_tracking_tokens.order_id
        and private.is_store_owner(o.store_id)
    )
    or (
      expires_at > now()
      and token = nullif((select current_setting('stoop.order_tracking_token', true)), '')
    )
  );

create policy order_tracking_tokens_anon_token_select on public.order_tracking_tokens
  for select to anon
  using (
    expires_at > now()
    and token = nullif((select current_setting('stoop.order_tracking_token', true)), '')
  );
