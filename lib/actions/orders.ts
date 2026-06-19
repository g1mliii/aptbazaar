"use server";

import { fieldErrorsFrom } from "@/lib/schemas/field-errors";
import { orderPlacementSchema } from "@/lib/schemas/order";
import { sendOrderConfirmationEmails } from "@/lib/email/order-confirmation";
import { orderRequestHash } from "@/lib/orders/request-hash";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { generateToken } from "@/lib/utils/token";

// Phase 4.4: customer order placement. The whole insert (orders + order_items +
// order_tracking_tokens + order_count_week bump) happens inside the place_order RPC
// (migration 0020), which runs SECURITY DEFINER so the multi-table write and the
// server-side price recompute don't depend on anon's narrow INSERT grants. We call it
// with the secret/service-role client — never the anon client.

// Tracking links stay useful well past pickup but not forever.
const TOKEN_TTL_HOURS = 24 * 30;

export type PlaceOrderResult =
  | { ok: true; token: string; clearCart: true }
  | { ok: false; fieldErrors?: Record<string, string>; error?: string };

export async function placeOrder(input: unknown): Promise<PlaceOrderResult> {
  const parsed = orderPlacementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }
  const order = parsed.data;

  const supabase = createSupabaseSecretClient();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("is_active, accept_pay_at_pickup")
    .eq("id", order.storeId)
    .maybeSingle();
  if (storeError) {
    return { ok: false, error: "We couldn't place your order. Try again in a moment." };
  }
  if (!store?.is_active) {
    return { ok: false, error: "This stoop isn't taking orders right now." };
  }
  if (order.paymentMode === "online") {
    return {
      ok: false,
      error: "Online payment isn't ready for this stoop yet. Choose pay at pickup."
    };
  }
  if (!store.accept_pay_at_pickup) {
    return {
      ok: false,
      error: "This stoop isn't taking pay-at-pickup orders right now."
    };
  }

  const requestHash = await orderRequestHash(order);
  // Minted here so the generator stays single-source; the RPC keeps it only on a fresh
  // insert and returns the order's stored token on a legitimate replay.
  const candidateToken = generateToken();

  const { data, error } = await supabase.rpc("place_order", {
    p_store_id: order.storeId,
    p_customer_name: order.customerName,
    p_customer_email: order.customerEmail,
    p_customer_phone_e164: order.customerPhoneE164 ?? null,
    p_payment_mode: order.paymentMode,
    p_pickup_window: order.pickupWindow ?? null,
    p_notes: order.notes ?? null,
    p_idempotency_key: order.idempotencyKey,
    p_request_hash: requestHash,
    p_token: candidateToken,
    p_token_ttl_hours: TOKEN_TTL_HOURS,
    p_items: order.items.map((i) => ({ product_id: i.productId, quantity: i.quantity }))
  });

  if (error) {
    // STP01: same idempotency key, different body. Refuse without leaking the first token.
    if (error.code === "STP01") {
      return {
        ok: false,
        error: "This order can't be placed again — refresh the page and start over."
      };
    }
    if (error.code === "STP04" || error.code === "STP05") {
      return {
        ok: false,
        error: "Something in your cart just sold out or changed. Refresh and try again."
      };
    }
    if (error.code === "STP02") {
      return { ok: false, error: "This stoop isn't taking orders right now." };
    }
    if (error.code === "STP06") {
      return {
        ok: false,
        error: "This stoop isn't taking that payment method right now."
      };
    }
    return { ok: false, error: "We couldn't place your order. Try again in a moment." };
  }

  const row = data?.[0];
  if (!row?.token) {
    return { ok: false, error: "We couldn't place your order. Try again in a moment." };
  }

  // Confirmation emails are best-effort: a delivery hiccup must not fail a placed order.
  // Skip on a replay so a double-tap doesn't double-send. Phase 5.5 wires the online
  // Stripe Checkout handoff here; in Phase 4 every order lands straight on the tracker.
  if (!row.replayed) {
    try {
      await sendOrderConfirmationEmails({ orderId: row.order_id, token: row.token });
    } catch {
      // Swallow — the order exists; the seller still sees it in the dashboard.
    }
  }

  return { ok: true, token: row.token, clearCart: true };
}
