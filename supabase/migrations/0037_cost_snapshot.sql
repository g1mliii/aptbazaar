-- Phase 9.8: internal cost-monitoring snapshot. One row per UTC day with estimated per-table row
-- counts and paid-order volume, so the founder dashboard can chart growth and unit economics over
-- time. Table counts intentionally use Postgres stats instead of exact count(*) scans: this is an
-- observability dashboard, not a ledger, and exact scans become a nightly table-wide bottleneck.
-- SERVICE-ROLE ONLY, exactly like audit_log (Phase 2.4): RLS enabled, zero policies, anon/auth
-- revoked. The nightly populate runs via pg_cron (no Cloudflare cron trigger — that account is at
-- its 5-trigger cap). Metrics that don't live in Postgres (R2 storage, Cloudflare bandwidth, Stripe
-- per-transaction fees) are left nullable and filled out-of-band by an operator/job.

create table public.cost_snapshot (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default (now() at time zone 'utc')::date,
  captured_at timestamptz not null default now(),
  table_counts jsonb not null default '{}'::jsonb,
  paid_order_count bigint not null default 0,
  paid_gmv_cents bigint not null default 0,
  -- Out-of-band (nullable): populated from Cloudflare / Stripe, not derivable in Postgres.
  storage_bytes bigint,
  bandwidth_bytes bigint,
  stripe_fees_cents bigint,
  platform_fees_cents bigint,
  unique (snapshot_date)
);

-- Keep the paid-order aggregate index-only for the nightly snapshot. The row-count side uses
-- pg_stat_user_tables.n_live_tup and does not scan user tables.
create index if not exists orders_paid_cost_snapshot_idx
  on public.orders (created_at desc)
  include (total_cents)
  where payment_status = 'paid';

alter table public.cost_snapshot enable row level security;
revoke all on public.cost_snapshot from anon, authenticated;
grant all on public.cost_snapshot to service_role;

-- Compute the in-DB metrics and upsert today's row. SECURITY DEFINER so the pg_cron job (which runs
-- as the table owner, not service_role) can read every table for counts. search_path pinned to keep
-- the definer-rights body from resolving objects through a caller-controlled path.
create or replace function public.snapshot_costs()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb;
  v_paid_order_count bigint := 0;
  v_paid_gmv_cents bigint := 0;
begin
  with target_tables(relname) as (
    values
      ('sellers'),
      ('stores'),
      ('products'),
      ('orders'),
      ('order_items'),
      ('subscribers'),
      ('buildings'),
      ('building_memberships'),
      ('qr_codes'),
      ('image_uploads'),
      ('stripe_events'),
      ('scan_event_daily')
  )
  select coalesce(jsonb_object_agg(t.relname, coalesce(s.n_live_tup, 0)), '{}'::jsonb)
    into v_counts
  from target_tables t
  left join pg_stat_user_tables s
    on s.schemaname = 'public'
   and s.relname = t.relname;

  select count(*), coalesce(sum(total_cents), 0)
    into v_paid_order_count, v_paid_gmv_cents
  from public.orders
  where payment_status = 'paid';

  insert into public.cost_snapshot (
    snapshot_date, table_counts, paid_order_count, paid_gmv_cents
  )
  values (
    (now() at time zone 'utc')::date,
    v_counts,
    v_paid_order_count,
    v_paid_gmv_cents
  )
  on conflict (snapshot_date) do update
    set table_counts = excluded.table_counts,
        paid_order_count = excluded.paid_order_count,
        paid_gmv_cents = excluded.paid_gmv_cents,
        captured_at = now();
end;
$$;

revoke all on function public.snapshot_costs() from public, anon, authenticated;
grant execute on function public.snapshot_costs() to service_role;

-- Schedule the nightly run when pg_cron is available. Enabling pg_cron is a one-time manual step on
-- Supabase (Dashboard → Database → Extensions, or `create extension pg_cron`); once enabled, re-run
-- this migration (or just this block) and the job registers. Guarded + idempotent so the migration
-- never fails on a project where pg_cron isn't enabled yet.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'nightly-cost-snapshot') then
      perform cron.unschedule('nightly-cost-snapshot');
    end if;
    perform cron.schedule(
      'nightly-cost-snapshot',
      '15 4 * * *',
      'select public.snapshot_costs();'
    );
  end if;
end
$$;
