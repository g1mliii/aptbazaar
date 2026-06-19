import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anonClient, serviceClient } from "./helpers/clients";
import type { Database } from "@/lib/supabase/database.types";
import { generateToken } from "@/lib/utils/token";

type PlaceOrderArgs = Database["public"]["Functions"]["place_order"]["Args"];
type PlaceOrderRow = Database["public"]["Functions"]["place_order"]["Returns"][number];

// Phase 4.4 regression: place_order is atomic, recomputes the total server-side, is idempotent at
// the row level, and never leaks a tracking token to a reused key with a different body.
// Requires migration 0020 applied to the target project.

const service = serviceClient();

let storeId: string;
let cookieId: string; // $6.00
let breadId: string; // $8.00, only 2 available
const userIds: string[] = [];

async function seedTenant(isActive = true) {
  const tag = `${Date.now()}-${generateToken().slice(0, 6)}`;
  const { data: created, error } = await service.auth.admin.createUser({
    email: `place-order-${tag}@example.test`,
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
      contact_email: `place-order-${tag}@example.test`
    })
    .select("id")
    .single();

  const { data: store } = await service
    .from("stores")
    .insert({
      seller_id: seller!.id,
      slug: `place-order-${tag}`,
      name: "Priya's Kitchen",
      is_active: isActive
    })
    .select("id")
    .single();

  return store!.id;
}

function items(cookieQty: number, breadQty?: number) {
  const list = [{ product_id: cookieId, quantity: cookieQty }];
  if (breadQty !== undefined) list.push({ product_id: breadId, quantity: breadQty });
  return list;
}

function args(overrides: Partial<PlaceOrderArgs> = {}): PlaceOrderArgs {
  return {
    p_store_id: storeId,
    p_customer_name: "Sam",
    p_customer_email: "sam@example.test",
    p_customer_phone_e164: null,
    p_payment_mode: "pay_at_pickup",
    p_pickup_window: "Sat 9am–1pm",
    p_notes: null,
    p_idempotency_key: `idem-${generateToken().slice(0, 8)}`,
    p_request_hash: `hash-${generateToken().slice(0, 8)}`,
    p_token: generateToken(),
    p_token_ttl_hours: 720,
    p_items: items(2),
    ...overrides
  };
}

beforeAll(async () => {
  storeId = await seedTenant(true);
  const { data: cookie } = await service
    .from("products")
    .insert({ store_id: storeId, name: "Cookies", price_cents: 600 })
    .select("id")
    .single();
  cookieId = cookie!.id;
  const { data: bread } = await service
    .from("products")
    .insert({ store_id: storeId, name: "Bread", price_cents: 800, qty_available: 2 })
    .select("id")
    .single();
  breadId = bread!.id;
});

afterAll(async () => {
  await Promise.all(userIds.map((id) => service.auth.admin.deleteUser(id)));
});

describe("place_order", () => {
  it("creates the order, items, and token; total is recomputed from DB prices", async () => {
    const { data, error } = await service.rpc(
      "place_order",
      args({ p_items: items(2, 1) })
    );
    expect(error).toBeNull();
    const row = data?.[0];
    expect(row?.replayed).toBe(false);
    // 2×$6 + 1×$8 = $20.00, ignoring any client-supplied total (the RPC takes none).
    expect(row?.total_cents).toBe(2000);

    const { data: items_ } = await service
      .from("order_items")
      .select("name_at_purchase, quantity, price_cents_at_purchase")
      .eq("order_id", row!.order_id);
    expect(items_).toHaveLength(2);

    const { data: token } = await service
      .from("order_tracking_tokens")
      .select("token")
      .eq("order_id", row!.order_id)
      .single();
    expect(token?.token).toBe(row?.token);
  });

  it("increments order_count_week inside the transaction", async () => {
    const before = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    await service.rpc("place_order", args());
    const after = await service
      .from("stores")
      .select("order_count_week")
      .eq("id", storeId)
      .single();
    expect(after.data!.order_count_week).toBe(before.data!.order_count_week + 1);
  });

  it("replays a matching key+hash to the same token without a second order", async () => {
    const key = `idem-${generateToken().slice(0, 8)}`;
    const hash = `hash-${generateToken().slice(0, 8)}`;
    const first = await service.rpc(
      "place_order",
      args({ p_idempotency_key: key, p_request_hash: hash, p_token: generateToken() })
    );
    const second = await service.rpc(
      "place_order",
      args({ p_idempotency_key: key, p_request_hash: hash, p_token: generateToken() })
    );
    expect(second.error).toBeNull();
    expect(second.data?.[0]?.replayed).toBe(true);
    expect(second.data?.[0]?.token).toBe(first.data?.[0]?.token);

    const { count } = await service
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("idempotency_key", key);
    expect(count).toBe(1);
  });

  it("holds idempotency under concurrent identical submits (no unique_violation leak)", async () => {
    const key = `idem-${generateToken().slice(0, 8)}`;
    const hash = `hash-${generateToken().slice(0, 8)}`;

    // Fire several identical placements at once. They race the SELECT-then-INSERT window in
    // place_order; the UNIQUE(store_id, idempotency_key) constraint lets exactly one win and the
    // losers must catch unique_violation and replay — not surface a raw 23505 to the caller.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        service.rpc(
          "place_order",
          args({
            p_idempotency_key: key,
            p_request_hash: hash,
            p_token: generateToken()
          })
        )
      )
    );

    for (const r of results) {
      expect(r.error).toBeNull();
    }

    const rows = results
      .map((r) => r.data?.[0])
      .filter((row): row is PlaceOrderRow => Boolean(row));
    expect(rows).toHaveLength(6);

    // Exactly one fresh insert; every other caller replayed.
    expect(rows.filter((row) => row.replayed === false)).toHaveLength(1);

    // All callers receive the one stored token...
    expect(new Set(rows.map((row) => row.token)).size).toBe(1);

    // ...and exactly one order row exists for the key.
    const { count } = await service
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("idempotency_key", key);
    expect(count).toBe(1);
  });

  it("rejects a reused key with a different body and never leaks the original token", async () => {
    const key = `idem-${generateToken().slice(0, 8)}`;
    const first = await service.rpc(
      "place_order",
      args({
        p_idempotency_key: key,
        p_request_hash: "hash-A",
        p_token: generateToken()
      })
    );
    const replay = await service.rpc(
      "place_order",
      args({
        p_idempotency_key: key,
        p_request_hash: "hash-B",
        p_token: generateToken()
      })
    );
    expect(replay.error).not.toBeNull();
    expect(replay.error?.code).toBe("STP01");
    expect(replay.data).toBeNull();
    // The error path returns no data, so the first order's token is never surfaced.
    expect(JSON.stringify(replay)).not.toContain(first.data![0]!.token);
  });

  it("rejects a quantity over a finite qty_available", async () => {
    // cookie=1 (valid) so we reach the bread line, which asks for 5 of only 2 available.
    const { error } = await service.rpc("place_order", args({ p_items: items(1, 5) }));
    expect(error?.code).toBe("STP05");
  });

  it("rejects online orders until Stripe Checkout is wired", async () => {
    const { error } = await service.rpc(
      "place_order",
      args({ p_payment_mode: "online" })
    );
    expect(error?.code).toBe("STP06");
  });

  it("rejects pay-at-pickup when the seller disabled it", async () => {
    const noPickupStore = await seedTenant(true);
    await service
      .from("stores")
      .update({ accept_pay_at_pickup: false })
      .eq("id", noPickupStore);
    const { data: product } = await service
      .from("products")
      .insert({ store_id: noPickupStore, name: "Card-only", price_cents: 500 })
      .select("id")
      .single();

    const { error } = await service.rpc(
      "place_order",
      args({
        p_store_id: noPickupStore,
        p_items: [{ product_id: product!.id, quantity: 1 }]
      })
    );
    expect(error?.code).toBe("STP06");
  });

  it("aggregates duplicate product lines before checking finite quantity", async () => {
    const { error } = await service.rpc(
      "place_order",
      args({
        p_items: [
          { product_id: breadId, quantity: 1 },
          { product_id: breadId, quantity: 2 }
        ]
      })
    );
    expect(error?.code).toBe("STP05");
  });

  it("rejects an order against an inactive store", async () => {
    const inactiveStore = await seedTenant(false);
    const { data: p } = await service
      .from("products")
      .insert({ store_id: inactiveStore, name: "Hidden", price_cents: 500 })
      .select("id")
      .single();
    const { error } = await service.rpc(
      "place_order",
      args({ p_store_id: inactiveStore, p_items: [{ product_id: p!.id, quantity: 1 }] })
    );
    expect(error?.code).toBe("STP02");
  });

  it("rejects a product from another store", async () => {
    const otherStore = await seedTenant(true);
    const { data: foreign } = await service
      .from("products")
      .insert({ store_id: otherStore, name: "Foreign", price_cents: 500 })
      .select("id")
      .single();
    const { error } = await service.rpc(
      "place_order",
      args({ p_items: [{ product_id: foreign!.id, quantity: 1 }] })
    );
    expect(error?.code).toBe("STP04");
  });

  it("is not callable by the anon role", async () => {
    const { error } = await anonClient().rpc("place_order", args());
    expect(error).not.toBeNull();
  });
});

describe("get_order_by_token after placement", () => {
  it("returns the order for a valid token and a PII-trimmed projection", async () => {
    const token = generateToken();
    const placed = await service.rpc("place_order", args({ p_token: token }));
    expect(placed.error).toBeNull();

    const anon = anonClient();
    const { data } = await anon.rpc("get_order_by_token", { p_token: token });
    const row = data?.[0];
    expect(row?.id).toBe(placed.data?.[0]?.order_id);
    // Projection carries no customer_email / phone / notes.
    expect(row).not.toHaveProperty("customer_email");
  });

  it("returns nothing for an expired token", async () => {
    const token = generateToken();
    const placed = await service.rpc("place_order", args({ p_token: token }));
    await service
      .from("order_tracking_tokens")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("order_id", placed.data![0]!.order_id);

    const { data } = await anonClient().rpc("get_order_by_token", { p_token: token });
    expect(data ?? []).toHaveLength(0);
  });
});
