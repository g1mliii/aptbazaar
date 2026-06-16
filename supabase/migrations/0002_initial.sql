-- Phase 2.1 + 2.5: core tables, enums, RLS.
-- Tenant isolation is enforced here in SQL, not in app middleware (hard invariant 1).
-- `users` is Supabase-managed (auth.users); we reference it, we do not create it.

-- Stamps updated_at on every UPDATE. Shared by every table that carries it.
-- (No table references, so it is safe to define before any table exists.)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.store_visibility as enum ('qr_only', 'building', 'nearby');
create type public.pickup_method as enum ('message_after_order', 'lobby_pickup', 'scheduled_window');
create type public.payment_mode as enum ('online', 'pay_at_pickup');
create type public.payment_status as enum ('unpaid', 'pay_at_pickup', 'paid', 'refunded', 'failed');
create type public.order_status as enum ('new', 'accepted', 'preparing', 'ready', 'complete', 'cancelled');

-- ---------------------------------------------------------------------------
-- sellers
-- ---------------------------------------------------------------------------

create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  display_name text not null,
  contact_email text not null,
  contact_phone_e164 text,
  -- Mailing address; required before any drop notification (CASL/CAN-SPAM physical-address rule, Phase 6.7).
  contact_address text,
  created_at timestamptz not null default now()
);

alter table public.sellers enable row level security;

grant select, insert, update on public.sellers to authenticated;

create policy sellers_owner_select on public.sellers
  for select to authenticated using (user_id = auth.uid());
create policy sellers_owner_insert on public.sellers
  for insert to authenticated with check (user_id = auth.uid());
create policy sellers_owner_update on public.sellers
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- stores
-- ---------------------------------------------------------------------------

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  slug text not null unique,
  name text not null,
  category text,
  description text,
  logo_url text,
  is_active boolean not null default true,
  visibility public.store_visibility not null default 'qr_only',
  pickup_method public.pickup_method not null default 'message_after_order',
  pickup_window_label text,
  pickup_public_note text,
  pickup_private_note text,
  accept_pay_at_pickup boolean not null default true,
  order_count_week integer not null default 0,
  -- Stamped once when the first scan lands (Phase 7.5); first_scan_seen_at is stamped
  -- by the dashboard the first time it renders the Seal, so the ceremony fires once.
  first_scan_at timestamptz,
  first_scan_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stores_seller_created_idx on public.stores (seller_id, created_at desc);

create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();

alter table public.stores enable row level security;

grant select, insert, update, delete on public.stores to authenticated;
grant select on public.stores to anon;

-- ---------------------------------------------------------------------------
-- RLS helpers (defined now that sellers + stores exist; SQL functions are validated
-- eagerly, so the tables they reference must already be present).
-- SECURITY DEFINER so they evaluate ownership/activeness without recursing through the
-- caller's own row policies. search_path is pinned to defeat search_path hijacking.
-- ---------------------------------------------------------------------------

create or replace function public.current_seller_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id from public.sellers s where s.user_id = auth.uid();
$$;

create or replace function public.is_store_owner(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores st
    join public.sellers se on se.id = st.seller_id
    where st.id = p_store_id
      and se.user_id = auth.uid()
  );
$$;

create or replace function public.is_store_active(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stores st
    where st.id = p_store_id and st.is_active = true
  );
$$;

create policy stores_owner_all on public.stores
  for all to authenticated
  using (is_store_owner(id))
  with check (seller_id = current_seller_id());
-- Anon (the public storefront) may read only an active store, found by slug.
create policy stores_anon_active_select on public.stores
  for select to anon using (is_active = true);

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency char(3) not null default 'CAD',
  image_url text,
  qty_available integer check (qty_available is null or qty_available >= 0),
  is_active boolean not null default true,
  allergens text[] not null default '{}',
  ingredients text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_store_active_created_idx on public.products (store_id, is_active, created_at desc);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

grant select, insert, update, delete on public.products to authenticated;
grant select on public.products to anon;

create policy products_owner_all on public.products
  for all to authenticated
  using (is_store_owner(store_id))
  with check (is_store_owner(store_id));
-- Anon sees a product only when both it and its parent store are active.
create policy products_anon_active_select on public.products
  for select to anon using (is_active = true and is_store_active(store_id));

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  customer_name text not null,
  customer_email text not null,
  customer_phone_e164 text,
  total_cents integer not null check (total_cents >= 0),
  currency char(3) not null default 'CAD',
  payment_mode public.payment_mode not null,
  payment_status public.payment_status not null,
  order_status public.order_status not null default 'new',
  pickup_time timestamptz,
  pickup_window text,
  notes text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  checkout_retry_count integer not null default 0,
  -- Client-generated idempotency key (Phase 4.4); scoped per-store so cross-store
  -- collisions are impossible. request_hash is sha256 of the canonicalized body.
  idempotency_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, idempotency_key)
);

create index orders_store_created_idx on public.orders (store_id, created_at desc);
create index orders_store_status_created_idx on public.orders (store_id, order_status, created_at desc);
create unique index orders_stripe_checkout_session_id_key
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create unique index orders_stripe_payment_intent_id_key
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

grant select, update on public.orders to authenticated;
grant insert on public.orders to anon;

create policy orders_owner_select on public.orders
  for select to authenticated using (is_store_owner(store_id));
create policy orders_owner_update on public.orders
  for update to authenticated using (is_store_owner(store_id)) with check (is_store_owner(store_id));
-- Anon (a customer) may place an order against an active store, but only in a safe initial
-- state: never self-declare a paid/refunded order or advance order_status. Payment state is
-- owned by the Stripe webhook (hard invariant 5); order_status is driven by the seller.
create policy orders_anon_insert on public.orders
  for insert to anon with check (
    is_store_active(store_id)
    and order_status = 'new'
    and payment_status in ('unpaid', 'pay_at_pickup')
    and checkout_retry_count = 0
  );
-- NOTE: anon may NOT directly SELECT orders. A tracked order is read only through
-- public.get_order_by_token(), which gates on the unguessable 128-bit token — a blanket
-- anon SELECT policy would expose every tracked order's PII to enumeration.

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  name_at_purchase text not null,
  quantity integer not null check (quantity > 0),
  price_cents_at_purchase integer not null check (price_cents_at_purchase >= 0)
);

create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_product_id_idx on public.order_items (product_id);

alter table public.order_items enable row level security;

grant select on public.order_items to authenticated;

-- Owner reads items for orders on a store they own. Items are inserted by the
-- placement RPC (Phase 4.4), which runs SECURITY DEFINER and bypasses RLS.
create policy order_items_owner_select on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and is_store_owner(o.store_id)
    )
  );

-- ---------------------------------------------------------------------------
-- order_tracking_tokens
-- ---------------------------------------------------------------------------

create table public.order_tracking_tokens (
  token text primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index order_tracking_tokens_order_id_idx on public.order_tracking_tokens (order_id);

alter table public.order_tracking_tokens enable row level security;

grant select on public.order_tracking_tokens to authenticated;

-- No anon policy: tokens are read capability-style through get_order_by_token().
-- Owner may read its orders' tokens for the dashboard tracking link.
create policy order_tracking_tokens_owner_select on public.order_tracking_tokens
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_tracking_tokens.order_id and is_store_owner(o.store_id)
    )
  );

-- Capability read for the public tracking page (Phase 4.6). The token is the secret;
-- a valid, unexpired token returns exactly its one order, never a fan-out.
create or replace function public.get_order_by_token(p_token text)
returns public.orders
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

-- service_role is the trusted backend role (server actions / route handlers via the secret
-- client). It bypasses RLS; these grants give it the table-level privileges to match.
grant all on
  public.sellers, public.stores, public.products,
  public.orders, public.order_items, public.order_tracking_tokens
  to service_role;
