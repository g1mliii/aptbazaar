import { describe, expect, it } from "vitest";

import { buildingRowSchema, buildingMembershipRowSchema } from "@/lib/schemas/building";
import {
  MAX_ORDER_LINE_QUANTITY,
  orderNotesSchema,
  orderPlacementSchema,
  orderRowSchema,
  orderStatusTransitionSchema,
  paymentModeSchema,
  paymentStatusSchema,
  TRANSITIONS
} from "@/lib/schemas/order";
import { orderItemRowSchema } from "@/lib/schemas/order-item";
import { productInputSchema, productRowSchema } from "@/lib/schemas/product";
import { sellerRowSchema } from "@/lib/schemas/seller";
import { storeRowSchema } from "@/lib/schemas/store";
import { subscriberRowSchema, subscriberInputSchema } from "@/lib/schemas/subscriber";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-12T00:00:00+00:00";

describe("row schemas accept representative rows", () => {
  it("seller", () => {
    expect(
      sellerRowSchema.parse({
        id: UUID,
        user_id: UUID2,
        display_name: "Maple Bakery",
        contact_email: "baker@example.com",
        contact_phone_e164: "+14155550100",
        contact_address: "345 Main St",
        created_at: TS
      })
    ).toBeTruthy();
  });

  it("store", () => {
    expect(
      storeRowSchema.parse({
        id: UUID,
        seller_id: UUID2,
        slug: "maple-bakery",
        name: "Maple Bakery",
        category: null,
        description: null,
        logo_url: null,
        is_active: true,
        visibility: "qr_only",
        pickup_method: "message_after_order",
        pickup_window_label: null,
        pickup_public_note: null,
        pickup_private_note: null,
        accept_pay_at_pickup: true,
        order_count_week: 0,
        orders_per_day_limit: null,
        orders_today: 0,
        orders_today_date: null,
        normalized_key: null,
        first_scan_at: null,
        first_scan_seen_at: null,
        created_at: TS,
        updated_at: TS
      })
    ).toBeTruthy();
  });

  it("product", () => {
    expect(
      productRowSchema.parse({
        id: UUID,
        store_id: UUID2,
        name: "Sourdough",
        description: null,
        price_cents: 800,
        currency: "CAD",
        image_url: null,
        image_alt: null,
        qty_available: null,
        max_per_order: null,
        is_active: true,
        allergens: ["gluten"],
        ingredients: null,
        created_at: TS,
        updated_at: TS
      })
    ).toBeTruthy();
  });

  it("order + order item", () => {
    expect(
      orderRowSchema.parse({
        id: UUID,
        store_id: UUID2,
        customer_name: "Sam",
        customer_email: "sam@example.com",
        customer_phone_e164: null,
        total_cents: 1600,
        currency: "CAD",
        payment_mode: "pay_at_pickup",
        payment_status: "pay_at_pickup",
        order_status: "new",
        pickup_time: null,
        pickup_window: null,
        notes: null,
        notes_seller: null,
        notes_shared: null,
        stock_restored: false,
        stripe_checkout_session_id: null,
        stripe_payment_intent_id: null,
        checkout_retry_count: 0,
        idempotency_key: "abc",
        request_hash: "def",
        created_at: TS,
        updated_at: TS
      })
    ).toBeTruthy();

    expect(
      orderItemRowSchema.parse({
        id: UUID,
        order_id: UUID2,
        product_id: null,
        name_at_purchase: "Sourdough",
        quantity: 2,
        price_cents_at_purchase: 800
      })
    ).toBeTruthy();
  });

  it("subscriber", () => {
    expect(
      subscriberRowSchema.parse({
        id: UUID,
        store_id: UUID2,
        email: "fan@example.com",
        consent_email: true,
        unsubscribe_token: "tok",
        verified_at: null,
        unsubscribed_at: null,
        created_at: TS
      })
    ).toBeTruthy();
  });

  it("building + membership", () => {
    expect(
      buildingRowSchema.parse({
        id: UUID,
        normalized_key: "345 main st|K1A0B1",
        display_name: "Maple Towers",
        city: "Ottawa",
        postal_code: "K1A0B1",
        public_slug: "maple-towers",
        access_type: "open",
        invite_code: null,
        invite_code_rotated_at: null,
        created_at: TS
      })
    ).toBeTruthy();

    expect(
      buildingMembershipRowSchema.parse({
        id: UUID,
        building_id: UUID2,
        store_id: UUID,
        status: "active",
        invited_at: null,
        joined_at: TS,
        created_at: TS
      })
    ).toBeTruthy();
  });
});

describe("schemas reject malformed input", () => {
  it("rejects a bad email", () => {
    expect(
      sellerRowSchema.safeParse({
        id: UUID,
        user_id: UUID2,
        display_name: "x",
        contact_email: "not-an-email",
        contact_phone_e164: null,
        contact_address: null,
        created_at: TS
      }).success
    ).toBe(false);
  });

  it("requires alt text when a photo is attached (Phase 9.6 a11y)", () => {
    const base = { name: "Sourdough", price_cents: 800 };
    expect(
      productInputSchema.safeParse({ ...base, image_upload_id: UUID }).success
    ).toBe(false);
    expect(
      productInputSchema.safeParse({ ...base, image_upload_id: UUID, image_alt: "ab" }).success
    ).toBe(false);
    expect(
      productInputSchema.safeParse({
        ...base,
        image_upload_id: UUID,
        image_alt: "A round sourdough loaf"
      }).success
    ).toBe(true);
    // No image → alt not required.
    expect(productInputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects negative price", () => {
    expect(
      productRowSchema.safeParse({
        id: UUID,
        store_id: UUID2,
        name: "x",
        description: null,
        price_cents: -1,
        currency: "CAD",
        image_url: null,
        image_alt: null,
        qty_available: null,
        max_per_order: null,
        is_active: true,
        allergens: [],
        ingredients: null,
        created_at: TS,
        updated_at: TS
      }).success
    ).toBe(false);
  });

  it("rejects an unknown order status", () => {
    expect(orderStatusReject()).toBe(false);
  });

  it("rejects impossible order quantities before they reach the RPC", () => {
    const base = {
      storeId: UUID,
      customerName: "Sam",
      customerEmail: "sam@example.com",
      paymentMode: "pay_at_pickup",
      idempotencyKey: UUID,
      items: [{ productId: UUID2, quantity: 1 }]
    };
    expect(orderPlacementSchema.safeParse(base).success).toBe(true);
    expect(
      orderPlacementSchema.safeParse({
        ...base,
        items: [{ productId: UUID2, quantity: MAX_ORDER_LINE_QUANTITY + 1 }]
      }).success
    ).toBe(false);
  });

  it("accepts the 'free' payment mode (giveaway settlement)", () => {
    expect(paymentModeSchema.safeParse("free").success).toBe(true);
    expect(paymentModeSchema.safeParse("online").success).toBe(true);
    expect(paymentModeSchema.safeParse("pay_at_pickup").success).toBe(true);
    expect(paymentModeSchema.safeParse("cheque").success).toBe(false);
  });

  it("accepts max_per_order as a positive int or null, rejects 0/negative", () => {
    const base = { name: "Free loaf", price_cents: 0 };
    expect(productInputSchema.safeParse({ ...base, max_per_order: 1 }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...base, max_per_order: null }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...base }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...base, max_per_order: 0 }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, max_per_order: -2 }).success).toBe(false);
  });

  it("storeRowSchema accepts a positive daily cap or null, rejects 0", () => {
    const row = {
      id: UUID,
      seller_id: UUID2,
      slug: "maple-bakery",
      name: "Maple Bakery",
      category: null,
      description: null,
      logo_url: null,
      is_active: true,
      visibility: "qr_only",
      pickup_method: "message_after_order",
      pickup_window_label: null,
      pickup_public_note: null,
      pickup_private_note: null,
      accept_pay_at_pickup: true,
      order_count_week: 0,
      orders_per_day_limit: 20,
      orders_today: 3,
      orders_today_date: "2026-06-25",
      normalized_key: null,
      first_scan_at: null,
      first_scan_seen_at: null,
      created_at: TS,
      updated_at: TS
    };
    expect(storeRowSchema.safeParse(row).success).toBe(true);
    expect(storeRowSchema.safeParse({ ...row, orders_per_day_limit: null }).success).toBe(true);
    expect(storeRowSchema.safeParse({ ...row, orders_per_day_limit: 0 }).success).toBe(false);
  });

  it("requires email consent on the subscribe form", () => {
    expect(
      subscriberInputSchema.safeParse({
        storeId: UUID,
        email: "x@example.com",
        consentEmail: false
      }).success
    ).toBe(false);
  });

  it("requires at least one item on order placement", () => {
    expect(
      orderPlacementSchema.safeParse({
        storeId: UUID,
        customerName: "Sam",
        customerEmail: "sam@example.com",
        paymentMode: "online",
        idempotencyKey: UUID,
        items: []
      }).success
    ).toBe(false);
  });

  it("rejects duplicate product lines on order placement", () => {
    expect(
      orderPlacementSchema.safeParse({
        storeId: UUID,
        customerName: "Sam",
        customerEmail: "sam@example.com",
        paymentMode: "pay_at_pickup",
        idempotencyKey: UUID,
        items: [
          { productId: UUID2, quantity: 1 },
          { productId: UUID2, quantity: 1 }
        ]
      }).success
    ).toBe(false);
  });

  it("rejects oversized order placement carts", () => {
    expect(
      orderPlacementSchema.safeParse({
        storeId: UUID,
        customerName: "Sam",
        customerEmail: "sam@example.com",
        paymentMode: "pay_at_pickup",
        idempotencyKey: UUID,
        items: Array.from({ length: 101 }, (_, index) => ({
          productId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
          quantity: 1
        }))
      }).success
    ).toBe(false);
  });
});

describe("Phase 6 order lifecycle schemas", () => {
  it("payment status round-trips the refund-lifecycle values", () => {
    expect(paymentStatusSchema.safeParse("refund_pending").success).toBe(true);
    expect(paymentStatusSchema.safeParse("refund_failed").success).toBe(true);
    expect(paymentStatusSchema.safeParse("refunded").success).toBe(true);
    expect(paymentStatusSchema.safeParse("nonsense").success).toBe(false);
  });

  it("status transition input requires a uuid and a valid target status", () => {
    expect(
      orderStatusTransitionSchema.safeParse({ orderId: UUID, to: "ready" }).success
    ).toBe(true);
    expect(
      orderStatusTransitionSchema.safeParse({ orderId: "nope", to: "ready" }).success
    ).toBe(false);
    expect(
      orderStatusTransitionSchema.safeParse({ orderId: UUID, to: "shipped" }).success
    ).toBe(false);
  });

  it("notes input accepts partial, nullable, and bounded notes", () => {
    expect(orderNotesSchema.safeParse({ orderId: UUID }).success).toBe(true);
    expect(
      orderNotesSchema.safeParse({ orderId: UUID, notesSeller: null }).success
    ).toBe(true);
    expect(
      orderNotesSchema.safeParse({ orderId: UUID, notesShared: "Out back, ring the bell." })
        .success
    ).toBe(true);
    expect(
      orderNotesSchema.safeParse({ orderId: UUID, notesSeller: "x".repeat(2001) }).success
    ).toBe(false);
  });

  it("TRANSITIONS encodes the state machine with terminal complete/cancelled", () => {
    expect(TRANSITIONS.new).toEqual(["accepted", "cancelled"]);
    expect(TRANSITIONS.ready).toEqual(["complete", "cancelled"]);
    expect(TRANSITIONS.complete).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
    // Every non-terminal status can cancel.
    for (const from of ["new", "accepted", "preparing", "ready"] as const) {
      expect(TRANSITIONS[from]).toContain("cancelled");
    }
  });
});

function orderStatusReject(): boolean {
  return orderRowSchema.safeParse({
    id: UUID,
    store_id: UUID2,
    customer_name: "Sam",
    customer_email: "sam@example.com",
    customer_phone_e164: null,
    total_cents: 100,
    currency: "CAD",
    payment_mode: "online",
    payment_status: "paid",
    order_status: "shipped",
    pickup_time: null,
    pickup_window: null,
    notes: null,
    notes_seller: null,
    notes_shared: null,
    stock_restored: false,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    checkout_retry_count: 0,
    idempotency_key: "a",
    request_hash: "b",
    created_at: TS,
    updated_at: TS
  }).success;
}
