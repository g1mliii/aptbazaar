-- Phase 2.4 + 2.5: payments inbox, connected accounts, audit log.
-- All three are SERVICE-ROLE ONLY: RLS is enabled with zero policies, so anon and
-- authenticated get nothing; the service role bypasses RLS. Reached only from server
-- actions / route handlers via the secret client (hard invariants 5, 8).

-- ---------------------------------------------------------------------------
-- stripe_events — durable webhook inbox. Persist raw payload first, process second.
-- ---------------------------------------------------------------------------

create table public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  type text not null,
  payload_jsonb jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  attempts integer not null default 0
);

create index stripe_events_unprocessed_received_idx
  on public.stripe_events (received_at)
  where processed_at is null;
create index stripe_events_type_received_idx
  on public.stripe_events (type, received_at desc);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- connected_accounts — Stripe Connect Express account state, synced via webhooks.
-- ---------------------------------------------------------------------------

create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null unique references public.sellers (id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  payouts_enabled boolean not null default false,
  last_synced_at timestamptz
);

alter table public.connected_accounts enable row level security;
revoke all on public.connected_accounts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- audit_log — sensitive ops (refunds, store deletion, building admin, drop sends).
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_id text,
  action text not null,
  target_table text,
  target_id text,
  payload_jsonb jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_actor_created_idx
  on public.audit_log (actor_type, actor_id, created_at desc);
create index audit_log_target_created_idx
  on public.audit_log (target_table, target_id, created_at desc)
  where target_table is not null and target_id is not null;

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;

-- Backend-only access for the trusted service role (the secret client bypasses RLS).
grant all on public.stripe_events, public.connected_accounts, public.audit_log to service_role;
