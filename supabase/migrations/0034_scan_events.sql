-- Phase 7.4: privacy-preserving scan attribution. One pre-aggregated counter per
-- (store, channel, day, bucket) — there are no per-scan rows, and no IP / user-agent /
-- fingerprint is ever persisted. The write path shards each hot store/channel/day counter across
-- 16 buckets, so a busy poster does not serialize every scan behind one row lock. Writes happen
-- ONLY through the service-role beacon route (/api/scan) via record_scan(); there is deliberately
-- no public insert/update policy, so a crafted PostgREST call can't touch this table directly. The
-- owner-select policy backs the dashboard's sharing summary (hard invariant 1: RLS before any
-- route reads the table).

create table public.scan_event_daily (
  store_id uuid not null references public.stores (id) on delete cascade,
  src text not null,
  day date not null,
  bucket smallint not null check (bucket >= 0 and bucket < 16),
  count bigint not null default 0 check (count >= 0),
  primary key (store_id, src, day, bucket)
);

alter table public.scan_event_daily enable row level security;

-- Ownership helper lives in the private schema since 0011 (public.is_store_owner was dropped).
create policy scan_event_daily_owner_select on public.scan_event_daily
  for select to authenticated using (private.is_store_owner(store_id));

grant select on public.scan_event_daily to authenticated;
grant all on public.scan_event_daily to service_role;

-- Atomic record-a-scan: bump today's per-channel counter and stamp the store's first_scan_at the
-- first time it's ever scanned (drives the Phase 7.5 "First scan!" ceremony). SECURITY DEFINER so
-- it can write through RLS, but execute is locked to service_role — the public beacon route is the
-- only caller. `day` is computed in UTC to match the dashboard aggregation. A bad store_id trips
-- the FK and the whole call rolls back (no orphan counter).
create or replace function public.record_scan(p_store_id uuid, p_src text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket smallint := floor(random() * 16)::smallint;
begin
  insert into public.scan_event_daily (store_id, src, day, bucket, count)
  values (p_store_id, p_src, (now() at time zone 'utc')::date, v_bucket, 1)
  on conflict (store_id, src, day, bucket)
  do update set count = scan_event_daily.count + 1;

  update public.stores
  set first_scan_at = now()
  where id = p_store_id and first_scan_at is null;
end;
$$;

revoke execute on function public.record_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.record_scan(uuid, text) to service_role;

-- Dashboard summary: aggregate inside Postgres so the QR page never pulls every daily/bucket row
-- into a server component. SECURITY INVOKER keeps the owner-select RLS policy load-bearing.
create or replace function public.get_store_scan_summary(p_store_id uuid)
returns table(src text, count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select scan_event_daily.src, sum(scan_event_daily.count)::bigint as count
  from public.scan_event_daily
  where scan_event_daily.store_id = p_store_id
  group by scan_event_daily.src
  order by sum(scan_event_daily.count) desc, scan_event_daily.src asc
$$;

revoke execute on function public.get_store_scan_summary(uuid) from public, anon;
grant execute on function public.get_store_scan_summary(uuid) to authenticated, service_role;
