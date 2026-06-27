"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sendOrderStatusEmail } from "@/lib/email/order-status";
import { fieldErrorsFrom } from "@/lib/schemas/field-errors";
import {
  orderNotesSchema,
  orderPlacementSchema,
  orderStatusTransitionSchema,
  willRefundOnCancel
} from "@/lib/schemas/order";
import { sendOrderConfirmationEmails } from "@/lib/email/order-confirmation";
import { publishOrderUpdate } from "@/lib/orders/order-stream";
import { orderRequestHash } from "@/lib/orders/request-hash";
import { captureFailure } from "@/lib/observability/capture";
import { guardAnonWrite } from "@/lib/ratelimit/anon-guard";
import {
  ANON_WINDOW_SECONDS,
  ORDER_IP_STORE_LIMIT,
  ORDER_STORE_LIMIT,
  orderIpStoreKey,
  orderStoreKey
} from "@/lib/ratelimit/anon-windows";
import { createOrderCheckoutSession } from "@/lib/stripe/checkout";
import { getConnectedAccount } from "@/lib/stripe/connected-account";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateToken } from "@/lib/utils/token";

import { refundOrder } from "./refunds";

// Phase 4.4: customer order placement. The whole insert (orders + order_items +
// order_tracking_tokens + order_count_week bump) happens inside the place_order RPC
// (migration 0020), which runs SECURITY DEFINER so the multi-table write and the
// server-side price recompute don't depend on anon's narrow INSERT grants. We call it
// with the secret/service-role client — never the anon client.

// Tracking links stay useful well past pickup but not forever.
const TOKEN_TTL_HOURS = 24 * 30;

export type PlaceOrderResult =
  | { ok: true; clearCart: true; token: string }
  | { ok: true; clearCart: true; redirectUrl: string }
  | { ok: false; fieldErrors?: Record<string, string>; error?: string };

export async function placeOrder(input: unknown): Promise<PlaceOrderResult> {
  const parsed = orderPlacementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }
  const order = parsed.data;

  // Phase 9.3: soft abuse controls before any DB work. The IP comes from the edge (cf-connecting-ip),
  // never the client body. Turnstile is the soft challenge; the KV windows are the hard caps, scoped
  // per (ip, store) and per store so a shared building NAT isn't blocked by one busy neighbour.
  const guard = await guardAnonWrite(order.turnstileToken, (ip, now) => [
    {
      key: orderIpStoreKey(ip, order.storeId, now),
      amount: 1,
      limit: ORDER_IP_STORE_LIMIT,
      windowSeconds: ANON_WINDOW_SECONDS
    },
    {
      key: orderStoreKey(order.storeId, now),
      amount: 1,
      limit: ORDER_STORE_LIMIT,
      windowSeconds: ANON_WINDOW_SECONDS
    }
  ]);
  if (!guard.ok) {
    return {
      ok: false,
      error:
        guard.reason === "turnstile"
          ? "We couldn't confirm you're a person. Refresh and try again."
          : "That's a lot of orders in a row. Give it a minute and try again."
    };
  }

  const supabase = createSupabaseSecretClient();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("is_active, accept_pay_at_pickup, seller_id")
    .eq("id", order.storeId)
    .maybeSingle();
  if (storeError) {
    captureFailure("order-placement", storeError, { storeId: order.storeId, stage: "store-read" });
    return { ok: false, error: "We couldn't place your order. Try again in a moment." };
  }
  if (!store?.is_active) {
    return { ok: false, error: "This stoop isn't taking orders right now." };
  }
  if (order.paymentMode === "pay_at_pickup") {
    if (!store.accept_pay_at_pickup) {
      return {
        ok: false,
        error: "This stoop isn't taking pay-at-pickup orders right now."
      };
    }
  } else if (order.paymentMode === "online") {
    // Online needs the seller's Stripe Connect account to take charges. The place_order RPC and
    // the orders trigger enforce this in SQL too (STP06); checking here gives a kinder message and
    // avoids minting a token for an order that can't proceed.
    const connected = await getConnectedAccount(store.seller_id);
    if (!connected?.charges_enabled) {
      return {
        ok: false,
        error: "Online payment isn't set up for this stoop yet. Choose pay at pickup."
      };
    }
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
    if (error.code === "STP07") {
      return {
        ok: false,
        error: "This stoop is fully booked for today. Check back tomorrow."
      };
    }
    if (error.code === "STP08") {
      return {
        ok: false,
        error: "There's a limit on how many of one of these you can grab. Lower the count and try again."
      };
    }
    // The STP* codes above are expected business outcomes; anything else is an unexpected failure.
    captureFailure("order-placement", error, { storeId: order.storeId, stage: "place_order_rpc" });
    return { ok: false, error: "We couldn't place your order. Try again in a moment." };
  }

  const row = data?.[0];
  if (!row?.token) {
    return { ok: false, error: "We couldn't place your order. Try again in a moment." };
  }

  if (order.paymentMode === "online") {
    // Online orders start 'unpaid'; the customer pays through Stripe-hosted Checkout and the
    // webhook (5.6) flips the order to 'paid'. The paid-confirmation email is sent then, not now.
    // A replay (double-tap) reuses the same idempotency key, so Stripe returns the existing
    // session — the customer lands back on the same checkout URL.
    const checkout = await createOrderCheckoutSession({
      orderId: row.order_id,
      token: row.token,
      attempt: 0
    });
    if (checkout.ok) {
      return { ok: true, clearCart: true, redirectUrl: checkout.url };
    }
    // The order exists but we couldn't start checkout. Send them to the tracking page, where
    // "Pay now" (5.5a) can retry rather than dead-ending.
    return { ok: true, clearCart: true, token: row.token };
  }

  // Pay-at-pickup and free ($0) orders settle on placement — no Stripe. ('free' carts land here
  // because they aren't 'online'; the RPC already marked them paid.) Confirmation emails are
  // best-effort — a delivery hiccup must not fail a placed order. Skip on a replay so a double-tap
  // doesn't double-send.
  if (!row.replayed) {
    try {
      await sendOrderConfirmationEmails({ orderId: row.order_id, token: row.token });
    } catch {
      // Swallow — the order exists; the seller still sees it in the dashboard.
    }
  }

  return { ok: true, clearCart: true, token: row.token };
}

// Phase 6 seller-side order lifecycle. All of these run server-side from the dashboard. They derive
// the seller from the session (getUser) and never trust a seller id from the client. The status and
// pay transitions go through pinned SECURITY DEFINER RPCs (migration 0028) so RLS stays load-bearing
// and a seller can never, e.g., self-declare an online order paid (hard invariant 5).

export type OrderActionResult = { ok: true } | { ok: false; error: string };

/** Notify an order's watchers of the current state, best-effort. */
async function publishOrderState(orderId: string): Promise<void> {
  try {
    const supabase = createSupabaseSecretClient();
    const { data: order } = await supabase
      .from("orders")
      .select("order_status, payment_status")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return;
    await publishOrderUpdate(orderId, {
      orderStatus: order.order_status,
      paymentStatus: order.payment_status
    });
  } catch {
    // Publish is decorative; the poll fallback keeps watchers correct.
  }
}

/** Move an order along the status machine. The DB function is the source of truth for the legal
 *  transitions and the same-state no-op. */
export async function updateOrderStatus(input: unknown): Promise<OrderActionResult> {
  const parsed = orderStatusTransitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That status change isn't allowed." };
  }
  const { orderId, to } = parsed.data;

  const server = await createSupabaseServerClient();
  const {
    data: { user }
  } = await server.auth.getUser();
  if (!user) {
    return { ok: false, error: "Please sign in." };
  }

  const supabase = createSupabaseSecretClient();
  const { data, error } = await supabase.rpc("transition_order_status", {
    p_order_id: orderId,
    p_seller_user_id: user.id,
    p_to: to
  });

  if (error) {
    if (error.code === "OD403") {
      return { ok: false, error: "We couldn't find that order." };
    }
    if (error.code === "OD409") {
      return { ok: false, error: "That status change isn't allowed." };
    }
    return {
      ok: false,
      error: "We couldn't update that order. Try again in a moment."
    };
  }

  const row = data?.[0];
  const from = row?.from_status;
  const next = row?.order_status;

  // Real transition (not a same-state no-op) and not the silent `new` state → email the customer.
  // The RPC's same-state no-op is what dedupes a double-click into no second send. The email and the
  // SSE publish are independent and both best-effort, so fire them together — a slow email round-trip
  // shouldn't delay watcher tabs, and a hiccup in either must not fail the action.
  const emailing =
    from && next && from !== next && next !== "new"
      ? sendOrderStatusEmail({ orderId, status: next }).catch(() => {})
      : Promise.resolve();
  await Promise.all([emailing, publishOrderState(orderId)]);
  revalidatePath("/dashboard/orders");
  return { ok: true };
}

/** Cancel an order. A paid online order is refunded FIRST (so a refund failure aborts the cancel);
 *  pay-at-pickup / unpaid orders skip straight to the cancelled transition, which restores stock. */
export async function cancelOrder(orderId: unknown): Promise<OrderActionResult> {
  const parsed = z.string().uuid().safeParse(orderId);
  if (!parsed.success) {
    return { ok: false, error: "We couldn't find that order." };
  }
  const id = parsed.data;

  const server = await createSupabaseServerClient();
  const {
    data: { user }
  } = await server.auth.getUser();
  if (!user) {
    return { ok: false, error: "Please sign in." };
  }

  // RLS owner policy gates the read; explicit columns, never select * on orders (invariant 6).
  const { data: order } = await server
    .from("orders")
    .select("id, payment_mode, payment_status, order_status")
    .eq("id", id)
    .maybeSingle();
  if (!order) {
    return { ok: false, error: "We couldn't find that order." };
  }
  if (order.order_status === "cancelled") {
    return { ok: false, error: "This order's already cancelled." };
  }
  if (order.order_status === "complete") {
    return { ok: false, error: "This order's already complete." };
  }

  // A paid online order must refund before it cancels. refundOrder flips paid → refund_pending;
  // the cancel transition then leaves stock alone (restore happens on the confirmed refund). If the
  // refund can't even start, abort so we don't cancel an order whose money is stuck with the seller.
  if (willRefundOnCancel(order.payment_mode, order.payment_status)) {
    const refund = await refundOrder(id);
    if (!refund.ok) {
      return refund;
    }
  }

  return updateOrderStatus({ orderId: id, to: "cancelled" });
}

/** Seller marks a pay-at-pickup order paid when cash/e-transfer changes hands. Online orders are
 *  refused at the RPC — Stripe owns their money state. */
export async function markPaid(orderId: unknown): Promise<OrderActionResult> {
  const parsed = z.string().uuid().safeParse(orderId);
  if (!parsed.success) {
    return { ok: false, error: "We couldn't find that order." };
  }
  const id = parsed.data;

  const server = await createSupabaseServerClient();
  const {
    data: { user }
  } = await server.auth.getUser();
  if (!user) {
    return { ok: false, error: "Please sign in." };
  }

  const supabase = createSupabaseSecretClient();
  const { error } = await supabase.rpc("mark_pay_at_pickup_paid", {
    p_order_id: id,
    p_seller_user_id: user.id
  });

  if (error) {
    if (error.code === "OD403") {
      return { ok: false, error: "We couldn't find that order." };
    }
    if (error.code === "OD409") {
      return {
        ok: false,
        error: "Only a pay-at-pickup order can be marked paid here."
      };
    }
    return {
      ok: false,
      error: "We couldn't update that order. Try again in a moment."
    };
  }

  await publishOrderState(id);
  revalidatePath("/dashboard/orders");
  return { ok: true };
}

/** Save the seller's private note and/or the shared (customer-visible) note. This is the one place
 *  a raw RLS UPDATE on orders is appropriate — the owner policy is the tenant guard. */
export async function updateOrderNotes(input: unknown): Promise<OrderActionResult> {
  const parsed = orderNotesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That note couldn't be saved." };
  }
  const { orderId, notesSeller, notesShared } = parsed.data;

  const server = await createSupabaseServerClient();
  const {
    data: { user }
  } = await server.auth.getUser();
  if (!user) {
    return { ok: false, error: "Please sign in." };
  }

  const patch: { notes_seller?: string | null; notes_shared?: string | null } = {};
  if (notesSeller !== undefined) patch.notes_seller = notesSeller;
  if (notesShared !== undefined) patch.notes_shared = notesShared;
  if (Object.keys(patch).length === 0) {
    return { ok: true };
  }

  const { data, error } = await server
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, error: "That note couldn't be saved." };
  }
  if (!data) {
    return { ok: false, error: "We couldn't find that order." };
  }

  revalidatePath("/dashboard/orders");
  return { ok: true };
}
