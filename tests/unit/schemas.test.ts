import { describe, expect, it } from "vitest";

import { buildingRowSchema, buildingMembershipRowSchema } from "@/lib/schemas/building";
import { orderRowSchema, orderPlacementSchema } from "@/lib/schemas/order";
import { orderItemRowSchema } from "@/lib/schemas/order-item";
import { productRowSchema } from "@/lib/schemas/product";
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
        qty_available: null,
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
    expect(sellerRowSchema.safeParse({
      id: UUID,
      user_id: UUID2,
      display_name: "x",
      contact_email: "not-an-email",
      contact_phone_e164: null,
      contact_address: null,
      created_at: TS
    }).success).toBe(false);
  });

  it("rejects negative price", () => {
    expect(productRowSchema.safeParse({
      id: UUID,
      store_id: UUID2,
      name: "x",
      description: null,
      price_cents: -1,
      currency: "CAD",
      image_url: null,
      qty_available: null,
      is_active: true,
      allergens: [],
      ingredients: null,
      created_at: TS,
      updated_at: TS
    }).success).toBe(false);
  });

  it("rejects an unknown order status", () => {
    expect(orderStatusReject()).toBe(false);
  });

  it("requires email consent on the subscribe form", () => {
    expect(
      subscriberInputSchema.safeParse({ storeId: UUID, email: "x@example.com", consentEmail: false })
        .success
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
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    checkout_retry_count: 0,
    idempotency_key: "a",
    request_hash: "b",
    created_at: TS,
    updated_at: TS
  }).success;
}
