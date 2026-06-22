import { afterAll, describe, expect, it } from "vitest";

import { serviceClient } from "./helpers/clients";
import type { Database } from "@/lib/supabase/database.types";
import { generateToken } from "@/lib/utils/token";

type PlaceOrderArgs = Database["public"]["Functions"]["place_order"]["Args"];

// Phase 5 regression: online orders are gated on the seller's Stripe Connect charges_enabled
// (migration 0024, in both the place_order RPC and the orders trigger), the refund transition is
// atomic + idempotent (migration 0026 mark_order_refunded), and the webhook inbox dedupes then
// claim-serializes by stripe_event_id. Requires migrations through 0027 applied to the target
// project.

const service = serviceClient();
const userIds: string[] = [];

async function seedTenant(opts: { chargesEnabled?: boolean } = {}) {
  const tag = `${Date.now()}-${generateToken().slice(0, 6)}`;
  const { data: created, error } = await service.auth.admin.createUser({
    email: `pay-${tag}@example.test`,
    password: `pw-${generateToken()}`,
    email_confirm: true
  });
  if (error || !created.user) throw new Error(`createUser: ${error?.message}`);
  userIds.push(created.user.id);

  const { data: seller } = await service
    .from("sellers")
    .insert({
      user_id: created.user.id,
      display_name: "Priya",
      contact_email: `pay-${tag}@example.test`
    })
    .select("id")
    .single();

  const { data: store } = await service
    .from("stores")
    .insert({
      seller_id: seller!.id,
      slug: `pay-${tag}`,
      name: "Priya's Kitchen",
      is_active: true
    })
    .select("id")
    .single();

  const { data: product } = await service
    .from("products")
    .insert({ store_id: store!.id, name: "Cookies", price_cents: 600 })
    .select("id")
    .single();

  if (opts.chargesEnabled !== undefined) {
    await service.from("connected_accounts").insert({
      seller_id: seller!.id,
      stripe_account_id: `acct_${tag}`,
      charges_enabled: opts.chargesEnabled,
      details_submitted: opts.chargesEnabled,
      payouts_enabled: opts.chargesEnabled
    });
  }

  return { sellerId: seller!.id, storeId: store!.id, productId: product!.id };
}

function onlineArgs(storeId: string, productId: string): PlaceOrderArgs {
  return {
    p_store_id: storeId,
    p_customer_name: "Sam",
    p_customer_email: "sam@example.test",
    p_customer_phone_e164: null,
    p_payment_mode: "online",
    p_pickup_window: null,
    p_notes: null,
    p_idempotency_key: `idem-${generateToken().slice(0, 8)}`,
    p_request_hash: `hash-${generateToken().slice(0, 8)}`,
    p_token: generateToken(),
    p_token_ttl_hours: 720,
    p_items: [{ product_id: productId, quantity: 1 }]
  };
}

afterAll(async () => {
  await Promise.all(userIds.map((id) => service.auth.admin.deleteUser(id)));
});

describe("online payment gating (migration 0024)", () => {
  it("rejects an online order when the seller has no connected account (STP06)", async () => {
    const { storeId, productId } = await seedTenant();
    const { error } = await service.rpc("place_order", onlineArgs(storeId, productId));
    expect(error?.code).toBe("STP06");
  });

  it("rejects an online order when charges_enabled is false (STP06)", async () => {
    const { storeId, productId } = await seedTenant({ chargesEnabled: false });
    const { error } = await service.rpc("place_order", onlineArgs(storeId, productId));
    expect(error?.code).toBe("STP06");
  });

  it("allows an online order when charges_enabled is true; it starts unpaid", async () => {
    const { storeId, productId } = await seedTenant({ chargesEnabled: true });
    const { data, error } = await service.rpc("place_order", onlineArgs(storeId, productId));
    expect(error).toBeNull();
    const row = data?.[0];
    expect(row?.replayed).toBe(false);

    const { data: order } = await service
      .from("orders")
      .select("payment_mode, payment_status")
      .eq("id", row!.order_id)
      .single();
    expect(order?.payment_mode).toBe("online");
    expect(order?.payment_status).toBe("unpaid");
  });

  it("the trigger blocks a direct online insert when charges_enabled is false (STP06)", async () => {
    const { storeId } = await seedTenant({ chargesEnabled: false });
    const { error } = await service.from("orders").insert({
      store_id: storeId,
      customer_name: "Sam",
      customer_email: "sam@example.test",
      total_cents: 600,
      payment_mode: "online",
      payment_status: "unpaid",
      idempotency_key: `idem-${generateToken().slice(0, 8)}`,
      request_hash: `hash-${generateToken().slice(0, 8)}`
    });
    expect(error?.code).toBe("STP06");
  });
});

describe("mark_order_refunded RPC (migration 0025)", () => {
  async function seedPaidOnlineOrder() {
    const { storeId } = await seedTenant({ chargesEnabled: true });
    const paymentIntentId = `pi_${generateToken().slice(0, 12)}`;
    // Set order_count_week so we can assert the decrement.
    await service.from("stores").update({ order_count_week: 1 }).eq("id", storeId);
    const { data: order } = await service
      .from("orders")
      .insert({
        store_id: storeId,
        customer_name: "Sam",
        customer_email: "sam@example.test",
        total_cents: 600,
        payment_mode: "online",
        payment_status: "paid",
        stripe_payment_intent_id: paymentIntentId,
        idempotency_key: `idem-${generateToken().slice(0, 8)}`,
        request_hash: `hash-${generateToken().slice(0, 8)}`
      })
      .select("id")
      .single();
    return { storeId, orderId: order!.id, paymentIntentId };
  }

  it("flips to refunded, decrements order_count_week, and writes one audit row, once", async () => {
    const { storeId, orderId } = await seedPaidOnlineOrder();
    const chargeId = `ch_${generateToken().slice(0, 12)}`;

    const first = await service.rpc("mark_order_refunded", {
      p_order_id: orderId,
      p_charge_id: chargeId,
      p_amount_refunded: 600
    });
    expect(first.data).toBe(orderId);

    const { data: order } = await service
      .from("orders")
      .select("payment_status")
      .eq("id", orderId)
      .single();
    expect(order?.payment_status).toBe("refunded");

    const { data: store } = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(store?.order_count_week).toBe(0);

    // The audit row is written in the same transaction as the flip.
    const { data: audits } = await service
      .from("audit_log")
      .select("action, target_id")
      .eq("target_id", orderId)
      .eq("action", "order.refunded");
    expect(audits).toHaveLength(1);

    // Idempotent: a webhook redelivery is a no-op — no second decrement, no duplicate audit row.
    const second = await service.rpc("mark_order_refunded", {
      p_order_id: orderId,
      p_charge_id: chargeId,
      p_amount_refunded: 600
    });
    expect(second.data).toBeNull();

    const { data: storeAfter } = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(storeAfter?.order_count_week).toBe(0);

    const { data: auditsAfter } = await service
      .from("audit_log")
      .select("action")
      .eq("target_id", orderId)
      .eq("action", "order.refunded");
    expect(auditsAfter).toHaveLength(1);
  });
});

describe("refund lifecycle + stock restore (Phase 6 / migration 0028)", () => {
  // A full tenant with a finite-stock product and a paid order whose stock has already been consumed
  // (qty 5 → 3 by a 2-unit sale). order_count_week is seeded to 1 so the restore is visible. Defaults
  // to an online/paid order; pass "pay_at_pickup" to seed a marked-paid cash order (no payment intent).
  async function seedPaidOnlineOrderWithStock(
    paymentMode: "online" | "pay_at_pickup" = "online"
  ) {
    const tag = `${Date.now()}-${generateToken().slice(0, 6)}`;
    const { data: created, error } = await service.auth.admin.createUser({
      email: `refund-${tag}@example.test`,
      password: `pw-${generateToken()}`,
      email_confirm: true
    });
    if (error || !created.user) throw new Error(`createUser: ${error?.message}`);
    userIds.push(created.user.id);

    const { data: seller } = await service
      .from("sellers")
      .insert({
        user_id: created.user.id,
        display_name: "Priya",
        contact_email: `refund-${tag}@example.test`
      })
      .select("id")
      .single();

    const { data: store } = await service
      .from("stores")
      .insert({
        seller_id: seller!.id,
        slug: `refund-${tag}`,
        name: "Priya's Kitchen",
        is_active: true,
        order_count_week: 1
      })
      .select("id")
      .single();

    await service.from("connected_accounts").insert({
      seller_id: seller!.id,
      stripe_account_id: `acct_${tag}`,
      charges_enabled: true,
      details_submitted: true,
      payouts_enabled: true
    });

    const { data: product } = await service
      .from("products")
      .insert({ store_id: store!.id, name: "Cookies", price_cents: 600, qty_available: 3 })
      .select("id")
      .single();

    const { data: order } = await service
      .from("orders")
      .insert({
        store_id: store!.id,
        customer_name: "Sam",
        customer_email: "sam@example.test",
        total_cents: 1200,
        payment_mode: paymentMode,
        payment_status: "paid",
        stripe_payment_intent_id:
          paymentMode === "online" ? `pi_${generateToken().slice(0, 12)}` : null,
        idempotency_key: `idem-${tag}`,
        request_hash: `hash-${tag}`
      })
      .select("id")
      .single();

    await service.from("order_items").insert({
      order_id: order!.id,
      product_id: product!.id,
      name_at_purchase: "Cookies",
      quantity: 2,
      price_cents_at_purchase: 600
    });

    return {
      userId: created.user.id,
      storeId: store!.id,
      productId: product!.id,
      orderId: order!.id
    };
  }

  it("a confirmed charge.refunded restores stock + count exactly once and is redelivery-safe", async () => {
    const { storeId, productId, orderId } = await seedPaidOnlineOrderWithStock();
    // refundOrder flips paid → refund_pending before the webhook confirms it.
    await service.from("orders").update({ payment_status: "refund_pending" }).eq("id", orderId);

    const chargeId = `ch_${generateToken().slice(0, 12)}`;
    const first = await service.rpc("mark_order_refunded", {
      p_order_id: orderId,
      p_charge_id: chargeId,
      p_amount_refunded: 1200
    });
    expect(first.data).toBe(orderId);

    const { data: order } = await service
      .from("orders")
      .select("payment_status, stock_restored")
      .eq("id", orderId)
      .single();
    expect(order?.payment_status).toBe("refunded");
    expect(order?.stock_restored).toBe(true);

    const { data: product } = await service
      .from("products")
      .select("qty_available")
      .eq("id", productId)
      .single();
    expect(product?.qty_available).toBe(5); // 3 restored by the 2-unit line

    const { data: store } = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(store?.order_count_week).toBe(0);

    // Redelivery: already refunded → no-op. No second restore.
    const second = await service.rpc("mark_order_refunded", {
      p_order_id: orderId,
      p_charge_id: chargeId,
      p_amount_refunded: 1200
    });
    expect(second.data).toBeNull();

    const { data: productAfter } = await service
      .from("products")
      .select("qty_available")
      .eq("id", productId)
      .single();
    expect(productAfter?.qty_available).toBe(5);
    const { data: storeAfter } = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(storeAfter?.order_count_week).toBe(0);
  });

  it("a paid cancel defers the restore to the refund (no double order_count_week decrement)", async () => {
    const { userId, storeId, productId, orderId } = await seedPaidOnlineOrderWithStock();
    await service.from("orders").update({ payment_status: "refund_pending" }).eq("id", orderId);

    // Cancelling the order while money is in flight must NOT restore stock/count yet.
    const cancel = await service.rpc("transition_order_status", {
      p_order_id: orderId,
      p_seller_user_id: userId,
      p_to: "cancelled"
    });
    expect(cancel.error).toBeNull();

    const { data: midProduct } = await service
      .from("products")
      .select("qty_available")
      .eq("id", productId)
      .single();
    expect(midProduct?.qty_available).toBe(3); // unchanged — restore deferred
    const { data: midStore } = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(midStore?.order_count_week).toBe(1);
    const { data: midOrder } = await service
      .from("orders")
      .select("stock_restored, order_status")
      .eq("id", orderId)
      .single();
    expect(midOrder?.order_status).toBe("cancelled");
    expect(midOrder?.stock_restored).toBe(false);

    // The confirmed refund is the single restore point — exactly once.
    await service.rpc("mark_order_refunded", {
      p_order_id: orderId,
      p_charge_id: `ch_${generateToken().slice(0, 12)}`,
      p_amount_refunded: 1200
    });

    const { data: finalProduct } = await service
      .from("products")
      .select("qty_available")
      .eq("id", productId)
      .single();
    expect(finalProduct?.qty_available).toBe(5);
    const { data: finalStore } = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(finalStore?.order_count_week).toBe(0);
  });

  it("a paid pay-at-pickup cancel restores stock + count immediately (no refund to defer to)", async () => {
    // A marked-paid cash order has no Stripe refund, so mark_order_refunded never fires for it. The
    // cancel itself must restore, or the stock/count would leak forever.
    const { userId, storeId, productId, orderId } =
      await seedPaidOnlineOrderWithStock("pay_at_pickup");

    const cancel = await service.rpc("transition_order_status", {
      p_order_id: orderId,
      p_seller_user_id: userId,
      p_to: "cancelled"
    });
    expect(cancel.error).toBeNull();

    const { data: order } = await service
      .from("orders")
      .select("order_status, stock_restored")
      .eq("id", orderId)
      .single();
    expect(order?.order_status).toBe("cancelled");
    expect(order?.stock_restored).toBe(true);

    const { data: product } = await service
      .from("products")
      .select("qty_available")
      .eq("id", productId)
      .single();
    expect(product?.qty_available).toBe(5); // 3 restored by the 2-unit line

    const { data: store } = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(store?.order_count_week).toBe(0);
  });
});

describe("webhook inbox dedup (stripe_events)", () => {
  it("a duplicate stripe_event_id is rejected by the unique constraint", async () => {
    const eventId = `evt_${generateToken().slice(0, 12)}`;
    const insert = () =>
      service.from("stripe_events").insert({
        stripe_event_id: eventId,
        type: "checkout.session.completed",
        payload_jsonb: { id: eventId }
      });

    const first = await insert();
    expect(first.error).toBeNull();

    const second = await insert();
    expect(second.error?.code).toBe("23505"); // unique_violation

    await service.from("stripe_events").delete().eq("stripe_event_id", eventId);
  });

  it("claims one processor per Stripe event and reclaims after release", async () => {
    const eventId = `evt_${generateToken().slice(0, 12)}`;
    await service.from("stripe_events").insert({
      stripe_event_id: eventId,
      type: "checkout.session.completed",
      payload_jsonb: { id: eventId }
    });

    const first = await service.rpc("claim_stripe_event", {
      p_stripe_event_id: eventId
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);

    const second = await service.rpc("claim_stripe_event", {
      p_stripe_event_id: eventId
    });
    expect(second.error).toBeNull();
    expect(second.data).toBe(false);

    await service
      .from("stripe_events")
      .update({ processing_started_at: null, error: "retryable failure" })
      .eq("stripe_event_id", eventId);

    const third = await service.rpc("claim_stripe_event", {
      p_stripe_event_id: eventId
    });
    expect(third.error).toBeNull();
    expect(third.data).toBe(true);

    await service.from("stripe_events").delete().eq("stripe_event_id", eventId);
  });
});
