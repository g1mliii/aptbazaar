import "server-only";

import type { OrderStatus, PaymentMode, PaymentStatus } from "@/lib/schemas/order";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 4.6: token-gated order tracking reads. The capability is the 128-bit token: the anon
// RPC get_order_by_token returns a row only for a valid, unexpired token, so once it hands back
// an order we can safely fetch that order's items + store basics with the server-only secret
// client (anon has no direct SELECT on order_items, by design).

export type TrackedOrder = {
  id: string;
  store_id: string;
  customer_name: string;
  total_cents: number;
  currency: string;
  payment_mode: PaymentMode;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  pickup_window: string | null;
  created_at: string;
  updated_at: string;
};

export type TrackedItem = {
  name: string;
  quantity: number;
  priceCents: number;
};

export type TrackedStore = {
  name: string;
  slug: string | null;
  pickupNote: string | null;
};

export type TrackingLookup =
  | {
      status: "ok";
      order: TrackedOrder;
      items: TrackedItem[];
      store: TrackedStore;
      notesShared: string | null;
    }
  | { status: "expired" }
  | { status: "unknown" };

/** Light projection used by both the page and the poll route. Null on bad/expired token. */
export async function fetchOrderByToken(
  token: string
): Promise<TrackedOrder | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("get_order_by_token", { p_token: token });
  return data?.[0] ?? null;
}

export function pickupNoteFor(store: {
  pickup_method: string;
  pickup_window_label: string | null;
  pickup_public_note: string | null;
}): string | null {
  if (store.pickup_public_note) return store.pickup_public_note;
  if (store.pickup_method === "scheduled_window") return store.pickup_window_label;
  if (store.pickup_method === "lobby_pickup") return "Lobby / front desk pickup";
  return null;
}

// A missing RPC row is either an expired token or a never-existed one. The page wants distinct
// copy (and 410 vs 404 semantics), so probe the token table server-side. Only call it "expired"
// when the token both exists AND its window has actually passed — a token that exists but is still
// in-window means get_order_by_token returned nothing for another reason (a transient read, the
// order momentarily unreadable), so fall back to "unknown" rather than mislabel a live link as
// expired.
async function classifyMissing(token: string): Promise<"expired" | "unknown"> {
  const supabase = createSupabaseSecretClient();
  const { data } = await supabase
    .from("order_tracking_tokens")
    .select("expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data) return "unknown";
  return new Date(data.expires_at).getTime() <= Date.now() ? "expired" : "unknown";
}

/** Full lookup for the tracking page: order + items + store, or why it isn't available. */
export async function loadTracking(token: string): Promise<TrackingLookup> {
  const order = await fetchOrderByToken(token);
  if (!order) {
    return { status: await classifyMissing(token) };
  }

  const secret = createSupabaseSecretClient();
  const [
    { data: items, error: itemsError },
    { data: store, error: storeError },
    { data: shared }
  ] = await Promise.all([
    secret
      .from("order_items")
      .select("name_at_purchase, quantity, price_cents_at_purchase")
      .eq("order_id", order.id),
    secret
      .from("stores")
      .select("name, slug, pickup_method, pickup_window_label, pickup_public_note")
      .eq("id", order.store_id)
      .single(),
    // notes_shared isn't on the get_order_by_token projection (kept stable to avoid type churn), so
    // read it directly with the secret client now that the token has gated this order.
    secret
      .from("orders")
      .select("notes_shared")
      .eq("id", order.id)
      .maybeSingle()
  ]);

  // A real order always has at least one item and a store. A failed read here is a transient
  // backend error, not a genuinely empty order — throw so the page surfaces an error rather than
  // rendering a confirmed order with an empty receipt.
  if (itemsError || storeError) {
    throw new Error(`Failed to load tracking details for order ${order.id}`, {
      cause: itemsError ?? storeError
    });
  }

  return {
    status: "ok",
    order,
    items: (items ?? []).map((i) => ({
      name: i.name_at_purchase,
      quantity: i.quantity,
      priceCents: i.price_cents_at_purchase
    })),
    store: {
      name: store?.name ?? "the seller",
      slug: store?.slug ?? null,
      pickupNote: store ? pickupNoteFor(store) : null
    },
    notesShared: shared?.notes_shared ?? null
  };
}
