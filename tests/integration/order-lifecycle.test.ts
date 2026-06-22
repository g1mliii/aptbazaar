import { afterAll, describe, expect, it } from "vitest";

import { serviceClient } from "./helpers/clients";
import type { Database } from "@/lib/supabase/database.types";
import { generateToken } from "@/lib/utils/token";

// Phase 6 regression: the order status machine (transition_order_status), inventory enforcement in
// place_order, exactly-once restore-on-cancel, and mark_pay_at_pickup_paid. Asserts the DB enum
// values (`ready`/`complete`, never `completed`). Requires migration 0028 applied to the target
// project.

type PlaceOrderArgs = Database["public"]["Functions"]["place_order"]["Args"];

const service = serviceClient();
const userIds: string[] = [];

type Seeded = { userId: string; sellerId: string; storeId: string; productId: string };

async function seed(opts: { qty?: number | null } = {}): Promise<Seeded> {
  const tag = `${Date.now()}-${generateToken().slice(0, 6)}`;
  const { data: created, error } = await service.auth.admin.createUser({
    email: `lifecycle-${tag}@example.test`,
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
      contact_email: `lifecycle-${tag}@example.test`
    })
    .select("id")
    .single();

  const { data: store } = await service
    .from("stores")
    .insert({
      seller_id: seller!.id,
      slug: `lifecycle-${tag}`,
      name: "Priya's Kitchen",
      is_active: true
    })
    .select("id")
    .single();

  const { data: product } = await service
    .from("products")
    .insert({
      store_id: store!.id,
      name: "Cookies",
      price_cents: 600,
      qty_available: opts.qty === undefined ? 5 : opts.qty
    })
    .select("id")
    .single();

  return {
    userId: created.user.id,
    sellerId: seller!.id,
    storeId: store!.id,
    productId: product!.id
  };
}

function placeArgs(
  storeId: string,
  productId: string,
  qty = 1,
  overrides: Partial<PlaceOrderArgs> = {}
): PlaceOrderArgs {
  return {
    p_store_id: storeId,
    p_customer_name: "Sam",
    p_customer_email: "sam@example.test",
    p_customer_phone_e164: null,
    p_payment_mode: "pay_at_pickup",
    p_pickup_window: null,
    p_notes: null,
    p_idempotency_key: `idem-${generateToken().slice(0, 8)}`,
    p_request_hash: `hash-${generateToken().slice(0, 8)}`,
    p_token: generateToken(),
    p_token_ttl_hours: 720,
    p_items: [{ product_id: productId, quantity: qty }],
    ...overrides
  };
}

async function placeOrder(storeId: string, productId: string, qty = 1): Promise<string> {
  const { data, error } = await service.rpc("place_order", placeArgs(storeId, productId, qty));
  if (error) throw new Error(`place_order: ${error.message}`);
  return data[0]!.order_id;
}

function transition(orderId: string, userId: string, to: Database["public"]["Enums"]["order_status"]) {
  return service.rpc("transition_order_status", {
    p_order_id: orderId,
    p_seller_user_id: userId,
    p_to: to
  });
}

afterAll(async () => {
  await Promise.all(userIds.map((id) => service.auth.admin.deleteUser(id)));
});

describe("transition_order_status", () => {
  it("walks new→accepted→preparing→ready→complete and persists the DB enum values", async () => {
    const { userId, storeId, productId } = await seed();
    const orderId = await placeOrder(storeId, productId);

    const path = [
      ["new", "accepted"],
      ["accepted", "preparing"],
      ["preparing", "ready"],
      ["ready", "complete"]
    ] as const;
    for (const [from, to] of path) {
      const { data, error } = await transition(orderId, userId, to);
      expect(error).toBeNull();
      expect(data?.[0]?.from_status).toBe(from);
      expect(data?.[0]?.order_status).toBe(to);
    }

    const { data: order } = await service
      .from("orders")
      .select("order_status")
      .eq("id", orderId)
      .single();
    expect(order?.order_status).toBe("complete");
  });

  it("rejects an illegal jump with OD409", async () => {
    const { userId, storeId, productId } = await seed();
    const orderId = await placeOrder(storeId, productId);
    const { error } = await transition(orderId, userId, "ready"); // new→ready is illegal
    expect(error?.code).toBe("OD409");
  });

  it("treats a terminal state as terminal (OD409 on any further move)", async () => {
    const { userId, storeId, productId } = await seed();
    const orderId = await placeOrder(storeId, productId);
    await transition(orderId, userId, "cancelled");
    const { error } = await transition(orderId, userId, "accepted");
    expect(error?.code).toBe("OD409");
  });

  it("same-state is an idempotent no-op (from === to, no error)", async () => {
    const { userId, storeId, productId } = await seed();
    const orderId = await placeOrder(storeId, productId);
    const { data, error } = await transition(orderId, userId, "new");
    expect(error).toBeNull();
    expect(data?.[0]?.from_status).toBe("new");
    expect(data?.[0]?.order_status).toBe("new");
  });

  it("rejects a non-owner with OD403", async () => {
    const a = await seed();
    const b = await seed();
    const orderId = await placeOrder(a.storeId, a.productId);
    const { error } = await transition(orderId, b.userId, "accepted");
    expect(error?.code).toBe("OD403");
  });

  it("restores stock + count exactly once when a pay-at-pickup order is cancelled", async () => {
    const { userId, storeId, productId } = await seed({ qty: 5 });
    const orderId = await placeOrder(storeId, productId, 2); // qty 5→3, order_count_week 1

    const { data: beforeStore } = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(beforeStore?.order_count_week).toBe(1);

    await transition(orderId, userId, "cancelled");

    const { data: p } = await service
      .from("products")
      .select("qty_available")
      .eq("id", productId)
      .single();
    expect(p?.qty_available).toBe(5);
    const { data: s } = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(s?.order_count_week).toBe(0);

    const { data: o } = await service
      .from("orders")
      .select("stock_restored")
      .eq("id", orderId)
      .single();
    expect(o?.stock_restored).toBe(true);

    // A same-state cancel no-op must not double-restore.
    await transition(orderId, userId, "cancelled");
    const { data: pAfter } = await service
      .from("products")
      .select("qty_available")
      .eq("id", productId)
      .single();
    expect(pAfter?.qty_available).toBe(5);
  });
});

describe("place_order inventory", () => {
  it("decrements a finite qty and leaves NULL (unlimited) untouched", async () => {
    const finite = await seed({ qty: 5 });
    await placeOrder(finite.storeId, finite.productId, 2);
    const { data: p1 } = await service
      .from("products")
      .select("qty_available")
      .eq("id", finite.productId)
      .single();
    expect(p1?.qty_available).toBe(3);

    const unlimited = await seed({ qty: null });
    await placeOrder(unlimited.storeId, unlimited.productId, 4);
    const { data: p2 } = await service
      .from("products")
      .select("qty_available")
      .eq("id", unlimited.productId)
      .single();
    expect(p2?.qty_available).toBeNull();
  });

  it("serializes two concurrent placements for the last unit: one wins, one STP05, qty ends at 0", async () => {
    const { storeId, productId } = await seed({ qty: 1 });
    const results = await Promise.all([
      service.rpc("place_order", placeArgs(storeId, productId, 1)),
      service.rpc("place_order", placeArgs(storeId, productId, 1))
    ]);
    const ok = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.error?.code).toBe("STP05");

    const { data: p } = await service
      .from("products")
      .select("qty_available")
      .eq("id", productId)
      .single();
    expect(p?.qty_available).toBe(0);
  });

  it("replays concurrent same-key submits after the winner consumes the last unit", async () => {
    const { storeId, productId } = await seed({ qty: 1 });
    const key = `idem-${generateToken().slice(0, 8)}`;
    const hash = `hash-${generateToken().slice(0, 8)}`;

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        service.rpc(
          "place_order",
          placeArgs(storeId, productId, 1, {
            p_idempotency_key: key,
            p_request_hash: hash,
            p_token: generateToken()
          })
        )
      )
    );

    for (const result of results) {
      expect(result.error).toBeNull();
    }
    const rows = results.map((r) => r.data?.[0]).filter(Boolean);
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row!.replayed === false)).toHaveLength(1);
    expect(new Set(rows.map((row) => row!.token)).size).toBe(1);

    const { data: p } = await service
      .from("products")
      .select("qty_available")
      .eq("id", productId)
      .single();
    expect(p?.qty_available).toBe(0);
  });
});

describe("mark_pay_at_pickup_paid", () => {
  async function seedOnlinePaidOrder(s: Seeded): Promise<string> {
    await service.from("connected_accounts").insert({
      seller_id: s.sellerId,
      stripe_account_id: `acct_${generateToken().slice(0, 8)}`,
      charges_enabled: true,
      details_submitted: true,
      payouts_enabled: true
    });
    const { data: order, error } = await service
      .from("orders")
      .insert({
        store_id: s.storeId,
        customer_name: "Sam",
        customer_email: "sam@example.test",
        total_cents: 600,
        payment_mode: "online",
        payment_status: "paid",
        stripe_payment_intent_id: `pi_${generateToken().slice(0, 10)}`,
        idempotency_key: `idem-${generateToken().slice(0, 8)}`,
        request_hash: `hash-${generateToken().slice(0, 8)}`
      })
      .select("id")
      .single();
    if (error) throw new Error(`seed online order: ${error.message}`);
    return order.id;
  }

  it("flips a pay-at-pickup order from pay_at_pickup to paid", async () => {
    const { userId, storeId, productId } = await seed();
    const orderId = await placeOrder(storeId, productId);
    const { data, error } = await service.rpc("mark_pay_at_pickup_paid", {
      p_order_id: orderId,
      p_seller_user_id: userId
    });
    expect(error).toBeNull();
    expect(data).toBe("paid");

    const { data: o } = await service
      .from("orders")
      .select("payment_status")
      .eq("id", orderId)
      .single();
    expect(o?.payment_status).toBe("paid");
  });

  it("refuses to mark an online order paid — Stripe owns that (OD409)", async () => {
    const s = await seed();
    const orderId = await seedOnlinePaidOrder(s);
    const { error } = await service.rpc("mark_pay_at_pickup_paid", {
      p_order_id: orderId,
      p_seller_user_id: s.userId
    });
    expect(error?.code).toBe("OD409");
  });

  it("refuses a non-owner (OD403)", async () => {
    const a = await seed();
    const b = await seed();
    const orderId = await placeOrder(a.storeId, a.productId);
    const { error } = await service.rpc("mark_pay_at_pickup_paid", {
      p_order_id: orderId,
      p_seller_user_id: b.userId
    });
    expect(error?.code).toBe("OD403");
  });
});
