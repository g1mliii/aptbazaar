-- Phase 3.x hotfix: quick-start tenant creation is server-only.
--
-- Environments that already applied 0015/0018 may still have the old authenticated RPC
-- signature. Replace the RPC with the service-only signature used by the auth callback and
-- remove the old overload so sellers cannot bypass the signed quick-start cookie checks.

create or replace function public.create_store_quickstart(
  p_user_id uuid,
  p_display_name text,
  p_contact_email text,
  p_store_name text,
  p_slug_base text,
  p_item_name text,
  p_price_cents integer,
  p_pickup_method public.pickup_method
)
returns table (store_id uuid, slug text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_seller_id uuid;
  v_store_id uuid;
  v_slug text;
  v_base text;
  v_candidate text;
  v_suffix text;
  v_attempt integer;
begin
  v_base := lower(regexp_replace(coalesce(p_slug_base, ''), '[^a-z0-9]+', '-', 'g'));
  v_base := regexp_replace(v_base, '(^-+|-+$)', '', 'g');
  v_base := regexp_replace(left(v_base, 40), '-+$', '');

  if v_base is null then
    v_base := 'stoop';
  end if;
  if v_base = '' then
    v_base := 'stoop';
  end if;

  if v_base = any(array[
    'admin', 'api', 'app', 'b', 's', 'o', 'dashboard', 'settings',
    'health', 'static', '_next', 'auth', 'login', 'signup',
    'stoop', 'support', 'help', 'official', 'billing', 'payments',
    'team', 'staff', 'about', 'contact', 'terms', 'privacy'
  ]) then
    v_base := rtrim(left(v_base || '-stoop', 40), '-');
  end if;

  if exists (select 1 from public.sellers s where s.user_id = p_user_id) then
    raise exception 'seller already exists for this user'
      using errcode = 'unique_violation';
  end if;

  insert into public.sellers (user_id, display_name, contact_email)
  values (p_user_id, p_display_name, p_contact_email)
  returning id into v_seller_id;

  v_candidate := v_base;
  for v_attempt in 0..8 loop
    begin
      insert into public.stores (seller_id, slug, name, pickup_method)
      values (v_seller_id, v_candidate, p_store_name, p_pickup_method)
      returning id, slug into v_store_id, v_slug;
      exit;
    exception when unique_violation then
      if v_attempt = 8 then
        raise exception 'could not allocate store slug'
          using errcode = 'unique_violation';
      end if;

      v_suffix := substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      v_candidate := rtrim(left(v_base, 33), '-') || '-' || v_suffix;
    end;
  end loop;

  insert into public.products (store_id, name, price_cents)
  values (v_store_id, p_item_name, p_price_cents);

  store_id := v_store_id;
  slug := v_slug;
  return next;
end;
$$;

revoke all on function public.create_store_quickstart(
  uuid, text, text, text, text, text, integer, public.pickup_method
) from public;
revoke all on function public.create_store_quickstart(
  uuid, text, text, text, text, text, integer, public.pickup_method
) from anon;
revoke all on function public.create_store_quickstart(
  uuid, text, text, text, text, text, integer, public.pickup_method
) from authenticated;
grant execute on function public.create_store_quickstart(
  uuid, text, text, text, text, text, integer, public.pickup_method
) to service_role;

drop function if exists public.create_store_quickstart(
  text, text, text, text, text, integer, public.pickup_method
);
