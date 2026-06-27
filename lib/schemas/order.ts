import { z } from "zod";

import { cents, currency, email, phoneE164, timestamptz, uuid } from "./common";

// "free" is a giveaway settlement (all-$0 cart): it skips Stripe and the pay-at-pickup gate and
// lands the order already settled. The storefront only submits it for a $0 cart; place_order is the
// real authority (it rejects 'free' on any priced cart).
export const paymentModeSchema = z.enum(["online", "pay_at_pickup", "free"]);
export const paymentStatusSchema = z.enum([
  "unpaid",
  "pay_at_pickup",
  "paid",
  "refunded",
  "failed",
  // Phase 6 refund lifecycle: a refund is initiated (refund_pending) then confirmed by Stripe
  // (refunded) or rejected (refund_failed). The UI never jumps paid → refunded instantly.
  "refund_pending",
  "refund_failed"
]);
export const orderStatusSchema = z.enum([
  "new",
  "accepted",
  "preparing",
  "ready",
  "complete",
  "cancelled"
]);

export type PaymentMode = z.infer<typeof paymentModeSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;

// Phase 6: the seller-driven status machine. Each status maps to the states it can move to;
// `complete` and `cancelled` are terminal. The DB function transition_order_status (migration 0028)
// is the source of truth — this map mirrors it so the UI can render the right primary button and
// the action can validate before the round-trip. Keep the two in lockstep.
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["complete", "cancelled"],
  complete: [],
  cancelled: []
};

// Cancelling a paid online order triggers a Stripe refund; pay-at-pickup / unpaid orders just cancel.
// One predicate so the seller's button copy (orders-board), the optimistic UI, and the server action
// all decide "will this cancel refund?" the same way. Mirrors the SQL stock-restore guard in 0028:
// because cancelOrder refunds (paid → refund_pending) before the transition, the DB only ever sees
// 'paid' here, so this `=== "paid"` check stays in lockstep with the broader SQL set.
export function willRefundOnCancel(
  mode: PaymentMode,
  paymentStatus: PaymentStatus
): boolean {
  return mode === "online" && paymentStatus === "paid";
}

export const MAX_ORDER_LINE_ITEMS = 100;
export const MAX_ORDER_LINE_QUANTITY = 2_147_483_647;

export const orderRowSchema = z.object({
  id: uuid,
  store_id: uuid,
  customer_name: z.string().min(1),
  customer_email: email,
  customer_phone_e164: phoneE164.nullable(),
  total_cents: cents,
  currency,
  payment_mode: paymentModeSchema,
  payment_status: paymentStatusSchema,
  order_status: orderStatusSchema,
  pickup_time: timestamptz.nullable(),
  pickup_window: z.string().nullable(),
  notes: z.string().nullable(),
  notes_seller: z.string().nullable(),
  notes_shared: z.string().nullable(),
  stock_restored: z.boolean(),
  stripe_checkout_session_id: z.string().nullable(),
  stripe_payment_intent_id: z.string().nullable(),
  checkout_retry_count: z.number().int().nonnegative(),
  idempotency_key: z.string().min(1),
  request_hash: z.string().min(1),
  created_at: timestamptz,
  updated_at: timestamptz
});

export type Order = z.infer<typeof orderRowSchema>;

// Customer order placement input (Phase 4.3/4.4). idempotencyKey is the client-generated
// UUIDv4 carried through to the UNIQUE(store_id, idempotency_key) row guard.
export const orderPlacementSchema = z
  .object({
    storeId: uuid,
    customerName: z.string().min(1, "Tell us who to look out for."),
    customerEmail: email,
    customerPhoneE164: phoneE164.optional(),
    paymentMode: paymentModeSchema,
    pickupWindow: z.string().optional(),
    notes: z.string().max(2000).optional(),
    idempotencyKey: z.uuid(),
    // Phase 9.3: Cloudflare Turnstile token from the widget; verified server-side, never persisted
    // and excluded from the request-hash canonicalization so it can't perturb idempotency.
    turnstileToken: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: uuid,
          quantity: z.number().int().positive().max(MAX_ORDER_LINE_QUANTITY)
        })
      )
      .min(1, "Your cart is empty.")
      .max(MAX_ORDER_LINE_ITEMS, "Split this into a smaller order.")
  })
  .superRefine((order, ctx) => {
    const seen = new Set<string>();
    order.items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({
          code: "custom",
          message: "Each product can appear once in the cart.",
          path: ["items", index, "productId"]
        });
        return;
      }
      seen.add(item.productId);
    });
  });

export type OrderPlacement = z.infer<typeof orderPlacementSchema>;

// Phase 6: seller moves an order along the status machine. The action revalidates `to` against
// TRANSITIONS / the DB function; this is the input shape the server action parses.
export const orderStatusTransitionSchema = z.object({
  orderId: uuid,
  to: orderStatusSchema
});

export type OrderStatusTransition = z.infer<typeof orderStatusTransitionSchema>;

// Phase 6: per-order notes. Both fields optional so a save can touch just one; nullable so the
// seller can clear a note. `notes_seller` is private; `notes_shared` shows on the tracking page.
export const orderNotesSchema = z.object({
  orderId: uuid,
  notesSeller: z.string().max(2000).nullable().optional(),
  notesShared: z.string().max(2000).nullable().optional()
});

export type OrderNotes = z.infer<typeof orderNotesSchema>;
