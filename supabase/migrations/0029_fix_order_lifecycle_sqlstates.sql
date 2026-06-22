-- Phase 6 follow-up: replace order lifecycle RPCs that may have been applied with invalid
-- six-character SQLSTATEs in 0028. Postgres custom SQLSTATEs must be exactly five characters.

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

  if v_from = p_to then
    order_status := v_from;
    from_status := v_from;
    return next;
    return;
  end if;

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

  if v_payment_mode <> 'pay_at_pickup' then
    raise exception 'not a pay-at-pickup order' using errcode = 'OD409';
  end if;

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
