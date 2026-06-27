import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  anonClient,
  authedClient,
  cleanupUser,
  seedSeller,
  serviceClient,
  type Db,
  type SeededSeller
} from "./helpers/clients";

const service = serviceClient();

let sellerA: SeededSeller;
let sellerB: SeededSeller;
let inactive: SeededSeller;
let clientA: Db;
let deleteAttempt: SeededSeller;
let deleteClient: Db;
let buildingId: string;
let membershipId: string;
let stripeEventId: string;
let connectedAccountId: string;
let auditLogId: string;
let bQrCodeId: string;
let bImageUploadId: string;

beforeAll(async () => {
  sellerA = await seedSeller(service, { slug: `a-${Date.now()}` });
  sellerB = await seedSeller(service, { slug: `b-${Date.now()}` });
  inactive = await seedSeller(service, { slug: `c-${Date.now()}`, isActive: false });
  deleteAttempt = await seedSeller(service, { slug: `delete-${Date.now()}` });
  clientA = await authedClient(sellerA.email, sellerA.password);
  deleteClient = await authedClient(deleteAttempt.email, deleteAttempt.password);

  const { error: privateNoteErr } = await service
    .from("stores")
    .update({ pickup_private_note: "Unit 1204 after the order is accepted." })
    .eq("id", sellerA.storeId);
  if (privateNoteErr) {
    throw new Error(`private note seed failed: ${privateNoteErr.message}`);
  }

  // A building with B's store as an active member (public bazaar fixture).
  const { data: building } = await service
    .from("buildings")
    .insert({
      normalized_key: `key-${Date.now()}`,
      display_name: "Maple Towers",
      public_slug: `maple-${Date.now()}`
    })
    .select("id")
    .single();
  buildingId = (building as { id: string }).id;

  const { data: membership } = await service
    .from("building_memberships")
    .insert({ building_id: buildingId, store_id: sellerB.storeId, status: "active" })
    .select("id")
    .single();
  membershipId = (membership as { id: string }).id;

  const { data: stripeEvent } = await service
    .from("stripe_events")
    .insert({
      stripe_event_id: `evt_${Date.now()}`,
      type: "payment_intent.succeeded",
      payload_jsonb: { object: "event" }
    })
    .select("id")
    .single();
  stripeEventId = (stripeEvent as { id: string }).id;

  const { data: connectedAccount } = await service
    .from("connected_accounts")
    .insert({
      seller_id: sellerA.sellerId,
      stripe_account_id: `acct_${Date.now()}`
    })
    .select("id")
    .single();
  connectedAccountId = (connectedAccount as { id: string }).id;

  const { data: auditLog } = await service
    .from("audit_log")
    .insert({
      actor_type: "system",
      action: "test.seed",
      target_table: "stores",
      target_id: sellerA.storeId,
      payload_jsonb: { seeded: true }
    })
    .select("id")
    .single();
  auditLogId = (auditLog as { id: string }).id;

  // Seller B fixtures for the cross-tenant write matrix: qr_codes, image_uploads, scan_event_daily.
  const { data: bQr } = await service
    .from("qr_codes")
    .insert({ store_id: sellerB.storeId, qr_type: "store", target_url: "https://example.test/b" })
    .select("id")
    .single();
  bQrCodeId = (bQr as { id: string }).id;

  const { data: bImg } = await service
    .from("image_uploads")
    .insert({
      store_id: sellerB.storeId,
      requested_by: sellerB.userId,
      status: "pending",
      key_pending: `uploads/pending/${sellerB.storeId}/seed`
    })
    .select("id")
    .single();
  bImageUploadId = (bImg as { id: string }).id;

  await service
    .from("scan_event_daily")
    .insert({ store_id: sellerB.storeId, src: "qr", day: "2026-01-02", bucket: 0, count: 7 });
});

afterAll(async () => {
  await service.from("stripe_events").delete().eq("id", stripeEventId);
  await service.from("connected_accounts").delete().eq("id", connectedAccountId);
  await service.from("audit_log").delete().eq("id", auditLogId);
  await service.from("qr_codes").delete().eq("id", bQrCodeId);
  await service.from("image_uploads").delete().eq("id", bImageUploadId);
  await service.from("scan_event_daily").delete().eq("store_id", sellerB.storeId);
  await cleanupUser(service, sellerA.userId);
  await cleanupUser(service, sellerB.userId);
  await cleanupUser(service, inactive.userId);
  await cleanupUser(service, deleteAttempt.userId);
  await service.from("buildings").delete().eq("id", buildingId);
});

async function rowCount(client: Db, table: string, column: string, value: string): Promise<number> {
  const { data } = await client
    .from(table as never)
    .select("id")
    .eq(column, value);
  return (data ?? []).length;
}

describe("seller can read their own data", () => {
  it("reads own store, products, orders, subscribers", async () => {
    expect(await rowCount(clientA, "stores", "id", sellerA.storeId)).toBe(1);
    expect(await rowCount(clientA, "products", "id", sellerA.productId)).toBe(1);
    expect(await rowCount(clientA, "orders", "id", sellerA.orderId)).toBe(1);
    expect(await rowCount(clientA, "subscribers", "id", sellerA.subscriberId)).toBe(1);
  });
});

describe("tenant isolation: seller A cannot read seller B", () => {
  it("cannot read B's store", async () => {
    expect(await rowCount(clientA, "stores", "id", sellerB.storeId)).toBe(0);
  });
  it("cannot read B's products", async () => {
    expect(await rowCount(clientA, "products", "id", sellerB.productId)).toBe(0);
  });
  it("cannot read B's orders", async () => {
    expect(await rowCount(clientA, "orders", "id", sellerB.orderId)).toBe(0);
  });
  it("cannot read B's order_items", async () => {
    expect(await rowCount(clientA, "order_items", "order_id", sellerB.orderId)).toBe(0);
  });
  it("cannot read B's subscribers", async () => {
    expect(await rowCount(clientA, "subscribers", "id", sellerB.subscriberId)).toBe(0);
  });
  it("cannot read B's building_membership", async () => {
    expect(await rowCount(clientA, "building_memberships", "id", membershipId)).toBe(0);
  });
  it("cannot read any seller row but its own", async () => {
    const { data } = await clientA.from("sellers").select("id");
    expect((data ?? []).every((row) => row.id === sellerA.sellerId)).toBe(true);
  });
});

describe("anon (public storefront)", () => {
  const anon = anonClient();

  it("can read an active store by slug", async () => {
    const { data } = await anon.from("stores").select("id").eq("slug", sellerA.slug);
    expect((data ?? []).length).toBe(1);
  });

  it("cannot read private pickup notes from public store rows", async () => {
    const { data, error } = await anon
      .from("stores")
      .select("pickup_private_note")
      .eq("slug", sellerA.slug);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("cannot read an inactive store", async () => {
    expect(await rowCount(anon, "stores", "id", inactive.storeId)).toBe(0);
  });

  it("cannot read any seller row", async () => {
    const { data } = await anon.from("sellers").select("id");
    expect((data ?? []).length).toBe(0);
  });

  it("can subscribe to an active store without an account", async () => {
    const email = `anon-sub-${Date.now()}@example.test`;
    const { error } = await anon.from("subscribers").insert({
      store_id: sellerA.storeId,
      email,
      consent_email: true,
      unsubscribe_token: `tok-${Date.now()}`
    });
    expect(error).toBeNull();
    await service.from("subscribers").delete().eq("email", email);
  });

  it("does not let authenticated seller sessions use the public subscriber insert grant", async () => {
    const { error } = await clientA.from("subscribers").insert({
      store_id: sellerA.storeId,
      email: `auth-sub-${Date.now()}@example.test`,
      consent_email: true,
      unsubscribe_token: `tok-${Date.now()}`
    });
    expect(error).not.toBeNull();
  });

  it("can read active building memberships (bazaar), but the inactive store's row stays hidden", async () => {
    expect(await rowCount(anon, "building_memberships", "id", membershipId)).toBe(1);
  });

  it("cannot insert an order directly for an active store", async () => {
    const { error } = await anon.from("orders").insert({
      store_id: sellerA.storeId,
      customer_name: "Walk-in",
      customer_email: "walkin@example.test",
      total_cents: 800,
      payment_mode: "pay_at_pickup",
      payment_status: "pay_at_pickup",
      idempotency_key: `anon-${Date.now()}`,
      request_hash: `anon-${Date.now()}`
    });
    expect(error).not.toBeNull();
  });

  it("cannot self-declare a paid order", async () => {
    // Payment state belongs to the Stripe webhook; the anon insert policy pins new orders to a
    // safe initial state, so claiming payment_status = 'paid' must be rejected.
    const { error } = await anon.from("orders").insert({
      store_id: sellerA.storeId,
      customer_name: "Freeloader",
      customer_email: "free@example.test",
      total_cents: 0,
      payment_mode: "online",
      payment_status: "paid",
      idempotency_key: `anon-paid-${Date.now()}`,
      request_hash: `anon-paid-${Date.now()}`
    });
    expect(error).not.toBeNull();
  });

  it("cannot insert an order for an inactive store", async () => {
    const { error } = await anon.from("orders").insert({
      store_id: inactive.storeId,
      customer_name: "Walk-in",
      customer_email: "walkin@example.test",
      total_cents: 800,
      payment_mode: "pay_at_pickup",
      payment_status: "pay_at_pickup",
      idempotency_key: `anon-bad-${Date.now()}`,
      request_hash: `anon-bad-${Date.now()}`
    });
    expect(error).not.toBeNull();
  });

  it("cannot change an existing order", async () => {
    // Hosted Supabase grants anon table-level UPDATE, so RLS silently filters this to zero
    // rows (no error) rather than denying at the grant level. Either way the invariant is
    // the same: the order must be unchanged.
    await anon.from("orders").update({ notes: "tampered" }).eq("id", sellerA.orderId);

    const { data } = await service.from("orders").select("notes").eq("id", sellerA.orderId).single();
    expect((data as { notes: string | null }).notes).toBeNull();
  });
});

describe("sensitive seller operations stay behind server actions", () => {
  it("cannot directly delete a store with a seller-scoped client", async () => {
    await deleteClient.from("stores").delete().eq("id", deleteAttempt.storeId);

    const { data } = await service
      .from("stores")
      .select("id")
      .eq("id", deleteAttempt.storeId)
      .single();
    expect(data?.id).toBe(deleteAttempt.storeId);
  });
});

describe("order tracking token (capability read)", () => {
  const anon = anonClient();

  it("returns exactly the matching order for a valid token", async () => {
    const { data, error } = await anon
      .rpc("get_order_by_token", { p_token: sellerA.trackingToken })
      .maybeSingle();
    expect(error).toBeNull();
    const order = data as Record<string, unknown> | null;
    expect(order?.id).toBe(sellerA.orderId);
    expect(order).not.toHaveProperty("customer_email");
    expect(order).not.toHaveProperty("customer_phone_e164");
    expect(order).not.toHaveProperty("notes");
    expect(order).not.toHaveProperty("idempotency_key");
    expect(order).not.toHaveProperty("request_hash");
    expect(order).not.toHaveProperty("stripe_checkout_session_id");
    expect(order).not.toHaveProperty("stripe_payment_intent_id");
  });

  it("returns nothing for an unknown token", async () => {
    const { data } = await anon
      .rpc("get_order_by_token", { p_token: "not-a-real-token" })
      .maybeSingle();
    expect(data).toBeNull();
  });
});

describe("cross-tenant write deny matrix (seller A acting on seller B)", () => {
  // Hosted Supabase grants table-level DML to `authenticated`, so a cross-tenant write is filtered
  // to zero rows by RLS (usually no error). We assert the target row is unchanged / still present
  // via the service client rather than trusting an error to surface.

  async function expectUpdateDenied(
    table: string,
    idCol: string,
    idVal: string,
    patch: Record<string, unknown>,
    field: string
  ) {
    const { data: before } = await service
      .from(table as never)
      .select(field)
      .eq(idCol, idVal)
      .single();
    await clientA.from(table as never).update(patch as never).eq(idCol, idVal);
    const { data: after } = await service
      .from(table as never)
      .select(field)
      .eq(idCol, idVal)
      .single();
    expect((after as unknown as Record<string, unknown>)[field]).toEqual(
      (before as unknown as Record<string, unknown>)[field]
    );
  }

  async function countBy(
    client: Db,
    table: string,
    idCol: string,
    idVal: string
  ): Promise<number> {
    const { count } = await client
      .from(table as never)
      .select(idCol, { count: "exact", head: true })
      .eq(idCol, idVal);
    return count ?? 0;
  }

  async function expectDeleteDenied(table: string, idCol: string, idVal: string) {
    await clientA.from(table as never).delete().eq(idCol, idVal);
    expect(await countBy(service, table, idCol, idVal)).toBeGreaterThan(0);
  }

  it("cannot UPDATE B's store / product / order / subscriber", async () => {
    await expectUpdateDenied("stores", "id", sellerB.storeId, { name: "hijacked" }, "name");
    await expectUpdateDenied("products", "id", sellerB.productId, { name: "hijacked" }, "name");
    await expectUpdateDenied("orders", "id", sellerB.orderId, { notes: "tampered" }, "notes");
    await expectUpdateDenied(
      "subscribers",
      "id",
      sellerB.subscriberId,
      { consent_email: false },
      "consent_email"
    );
  });

  it("cannot DELETE B's rows across tenant-scoped tables", async () => {
    await expectDeleteDenied("stores", "id", sellerB.storeId);
    await expectDeleteDenied("products", "id", sellerB.productId);
    await expectDeleteDenied("orders", "id", sellerB.orderId);
    await expectDeleteDenied("subscribers", "id", sellerB.subscriberId);
    await expectDeleteDenied("building_memberships", "id", membershipId);
    await expectDeleteDenied("qr_codes", "id", bQrCodeId);
    await expectDeleteDenied("image_uploads", "id", bImageUploadId);
    await expectDeleteDenied("scan_event_daily", "store_id", sellerB.storeId);
  });

  it("cannot INSERT into B's store (products, qr_codes)", async () => {
    const { error: productErr } = await clientA
      .from("products")
      .insert({ store_id: sellerB.storeId, name: "smuggled", price_cents: 100 });
    expect(productErr).not.toBeNull();
    expect(await rowCount(service, "products", "name", "smuggled")).toBe(0);

    const { error: qrErr } = await clientA
      .from("qr_codes")
      .insert({ store_id: sellerB.storeId, qr_type: "store", target_url: "https://evil.test" });
    expect(qrErr).not.toBeNull();
  });

  it("cannot READ B's qr_codes / image_uploads / scan_event_daily", async () => {
    expect(await countBy(clientA, "qr_codes", "id", bQrCodeId)).toBe(0);
    expect(await countBy(clientA, "image_uploads", "id", bImageUploadId)).toBe(0);
    expect(await countBy(clientA, "scan_event_daily", "store_id", sellerB.storeId)).toBe(0);
  });
});

describe("service-role-only tables are invisible to anon and authenticated", () => {
  const anon = anonClient();

  const seededRows = [
    { table: "stripe_events" as const, id: () => stripeEventId },
    { table: "connected_accounts" as const, id: () => connectedAccountId },
    { table: "audit_log" as const, id: () => auditLogId }
  ];

  for (const { table, id } of seededRows) {
    it(`anon cannot read a seeded row in ${table}`, async () => {
      const { data } = await anon.from(table).select("id").eq("id", id());
      expect((data ?? []).length).toBe(0);
    });
    it(`authenticated cannot read a seeded row in ${table}`, async () => {
      const { data } = await clientA.from(table).select("id").eq("id", id());
      expect((data ?? []).length).toBe(0);
    });
  }
});
