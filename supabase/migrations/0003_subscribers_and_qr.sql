-- Phase 2.2 + 2.5: subscribers and QR codes.
-- No phone / SMS fields in v1 — we have no SMS provider, so we don't capture consent we can't honor.

-- ---------------------------------------------------------------------------
-- subscribers
-- ---------------------------------------------------------------------------

create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  email text not null,
  consent_email boolean not null default false,
  -- 128-bit URL-safe random, same generator as order_tracking_tokens.
  unsubscribe_token text not null unique,
  verified_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (store_id, email)
);

create index subscribers_store_created_idx on public.subscribers (store_id, created_at desc);
create index subscribers_store_active_drop_idx
  on public.subscribers (store_id, created_at desc)
  where verified_at is not null and unsubscribed_at is null;

alter table public.subscribers enable row level security;

grant select on public.subscribers to authenticated;
grant insert on public.subscribers to anon;

create policy subscribers_owner_select on public.subscribers
  for select to authenticated using (is_store_owner(store_id));
-- Anon (a storefront visitor) may opt in to an active store. Route-level rate limit lands in Phase 9.3.
create policy subscribers_anon_insert on public.subscribers
  for insert to anon with check (is_store_active(store_id));

-- ---------------------------------------------------------------------------
-- qr_codes
-- ---------------------------------------------------------------------------

create type public.qr_type as enum ('store', 'product', 'bazaar');

create table public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  qr_type public.qr_type not null,
  target_url text not null,
  image_url text,
  created_at timestamptz not null default now()
);

create index qr_codes_store_type_created_idx on public.qr_codes (store_id, qr_type, created_at desc);

alter table public.qr_codes enable row level security;

grant select, insert, update, delete on public.qr_codes to authenticated;

create policy qr_codes_owner_all on public.qr_codes
  for all to authenticated
  using (is_store_owner(store_id))
  with check (is_store_owner(store_id));

grant all on public.subscribers, public.qr_codes to service_role;
