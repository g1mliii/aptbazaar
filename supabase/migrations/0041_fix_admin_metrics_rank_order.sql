-- Forward fix for environments that already applied 0040_admin_metrics_rpc.sql.
-- Supabase will not rerun an applied migration when its file changes, so replace only the RPC here.

create or replace function public.get_admin_metrics(
  p_fee_bps integer,
  p_top_limit integer default 10
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with paid as (
    select
      o.store_id,
      o.total_cents,
      round((o.total_cents::numeric * p_fee_bps) / 10000) as fee_cents
    from public.orders o
    where o.payment_status = 'paid'
  ),
  seller_rollup as (
    select
      s.seller_id,
      sum(p.total_cents) as gmv_cents,
      count(*) as order_count
    from paid p
    join public.stores s on s.id = p.store_id
    group by s.seller_id
  ),
  building_rollup as (
    select
      m.building_id,
      sum(p.total_cents) as gmv_cents,
      count(*) as order_count
    from paid p
    join public.building_memberships m
      on m.store_id = p.store_id and m.status = 'active'
    group by m.building_id
  )
  select jsonb_build_object(
    'store_count', (select count(*) from public.stores),
    'product_count', (select count(*) from public.products),
    'paid_order_count', (select count(*) from paid),
    'gmv_cents', coalesce((select sum(total_cents) from paid), 0),
    'platform_fees_cents', coalesce((select sum(fee_cents) from paid), 0),
    'top_sellers', coalesce((
      select jsonb_agg(row order by gmv_cents desc, order_count desc, seller_id)
      from (
        select
          sr.seller_id,
          sr.gmv_cents,
          sr.order_count,
          jsonb_build_object(
            'seller_id', sr.seller_id,
            'name', coalesce(se.display_name, 'Unknown seller'),
            'gmv_cents', sr.gmv_cents,
            'order_count', sr.order_count
          ) as row
        from seller_rollup sr
        left join public.sellers se on se.id = sr.seller_id
        order by sr.gmv_cents desc, sr.order_count desc, sr.seller_id
        limit greatest(p_top_limit, 0)
      ) ranked
    ), '[]'::jsonb),
    'top_buildings', coalesce((
      select jsonb_agg(row order by gmv_cents desc, order_count desc, building_id)
      from (
        select
          br.building_id,
          br.gmv_cents,
          br.order_count,
          jsonb_build_object(
            'building_id', br.building_id,
            'name', coalesce(b.display_name, 'Unknown building'),
            'gmv_cents', br.gmv_cents,
            'order_count', br.order_count
          ) as row
        from building_rollup br
        left join public.buildings b on b.id = br.building_id
        order by br.gmv_cents desc, br.order_count desc, br.building_id
        limit greatest(p_top_limit, 0)
      ) ranked
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_admin_metrics(integer, integer) from public, anon, authenticated;
grant execute on function public.get_admin_metrics(integer, integer) to service_role;
