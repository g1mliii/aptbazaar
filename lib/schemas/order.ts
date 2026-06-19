import { z } from "zod";

import { cents, currency, email, phoneE164, timestamptz, uuid } from "./common";

export const paymentModeSchema = z.enum(["online", "pay_at_pickup"]);
export const paymentStatusSchema = z.enum([
  "unpaid",
  "pay_at_pickup",
  "paid",
  "refunded",
  "failed"
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

export const MAX_ORDER_LINE_ITEMS = 100;

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
    items: z
      .array(
        z.object({
          productId: uuid,
          quantity: z.number().int().positive()
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
