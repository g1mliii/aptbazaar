import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { generateToken } from "@/lib/utils/token";

// Config resolves from env (CI exports it from `supabase status`) and falls back to the
// deterministic local-supabase defaults so `npm run test:integration` works out of the box
// after `supabase start`.
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

export type Db = SupabaseClient<Database>;

const noPersist = { auth: { autoRefreshToken: false, persistSession: false } } as const;

/** Anon client — subject to RLS as the `anon` role (the public storefront). */
export function anonClient(): Db {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, noPersist);
}

/** Service-role client — bypasses RLS. Used only to SEED fixtures, never to assert access. */
export function serviceClient(): Db {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, noPersist);
}

export interface SeededSeller {
  userId: string;
  email: string;
  password: string;
  sellerId: string;
  storeId: string;
  slug: string;
  productId: string;
  orderId: string;
  trackingToken: string;
  subscriberId: string;
}

let counter = 0;

/**
 * Seeds a full tenant (auth user → seller → store → product → order → token → subscriber)
 * via the service role. `isActive` controls the store's public visibility.
 */
export async function seedSeller(
  service: Db,
  opts: { slug: string; isActive?: boolean } = { slug: "" }
): Promise<SeededSeller> {
  counter += 1;
  const tag = `${Date.now()}-${counter}-${generateToken().slice(0, 8)}`;
  const email = `seller-${tag}@example.test`;
  const password = `pw-${generateToken()}`;
  const slug = opts.slug || `store-${tag}`;
  const isActive = opts.isActive ?? true;

  const { data: created, error: userErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (userErr || !created.user) {
    throw new Error(`createUser failed: ${userErr?.message}`);
  }
  const userId = created.user.id;

  const sellerId = await insertReturningId(service, "sellers", {
    user_id: userId,
    display_name: `Seller ${tag}`,
    contact_email: email
  });

  const storeId = await insertReturningId(service, "stores", {
    seller_id: sellerId,
    slug,
    name: `Store ${tag}`,
    is_active: true
  });

  const productId = await insertReturningId(service, "products", {
    store_id: storeId,
    name: "Sourdough",
    price_cents: 800
  });

  const orderId = await insertReturningId(service, "orders", {
    store_id: storeId,
    customer_name: "Sam",
    customer_email: `customer-${tag}@example.test`,
    total_cents: 800,
    payment_mode: "pay_at_pickup",
    payment_status: "pay_at_pickup",
    idempotency_key: `idem-${tag}`,
    request_hash: `hash-${tag}`
  });

  const trackingToken = generateToken();
  const { error: tokenErr } = await service.from("order_tracking_tokens").insert({
    token: trackingToken,
    order_id: orderId,
    expires_at: new Date(Date.now() + 86_400_000).toISOString()
  });
  if (tokenErr) {
    throw new Error(`token seed failed: ${tokenErr.message}`);
  }

  const subscriberId = await insertReturningId(service, "subscribers", {
    store_id: storeId,
    email: `fan-${tag}@example.test`,
    consent_email: true,
    unsubscribe_token: generateToken()
  });

  if (!isActive) {
    const { error: deactivateErr } = await service
      .from("stores")
      .update({ is_active: false })
      .eq("id", storeId);
    if (deactivateErr) {
      throw new Error(`deactivate store failed: ${deactivateErr.message}`);
    }
  }

  return {
    userId,
    email,
    password,
    sellerId,
    storeId,
    slug,
    productId,
    orderId,
    trackingToken,
    subscriberId
  };
}

/** A client signed in as the given seller (role = authenticated). */
export async function authedClient(email: string, password: string): Promise<Db> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, noPersist);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`signIn failed: ${error.message}`);
  }
  return client;
}

export async function cleanupUser(service: Db, userId: string): Promise<void> {
  // Cascades through sellers → stores → products/orders/... via ON DELETE CASCADE.
  await service.auth.admin.deleteUser(userId);
}

async function insertReturningId(
  service: Db,
  table: "sellers" | "stores" | "products" | "orders" | "subscribers",
  row: Record<string, unknown>
): Promise<string> {
  const { data, error } = await service
    .from(table)
    .insert(row as never)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seed ${table} failed: ${error?.message}`);
  }
  return data.id;
}
