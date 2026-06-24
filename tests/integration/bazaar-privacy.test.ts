import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  anonClient,
  cleanupUser,
  seedSeller,
  serviceClient,
  type SeededSeller
} from "./helpers/clients";

const service = serviceClient();
const anon = anonClient();

let sellerA: SeededSeller;
let sellerB: SeededSeller;
let qrOnly: SeededSeller;
let buildingId: string;
let publicSlug: string;

async function sync(storeId: string): Promise<void> {
  const { error } = await service.rpc("sync_store_building_membership", {
    p_store_id: storeId
  });
  if (error) {
    throw new Error(`sync failed: ${error.message}`);
  }
}

async function publicBazaarPayload() {
  const { data: building, error: buildingError } = await anon
    .from("buildings")
    .select("id, display_name, city, public_slug, access_type, created_at")
    .eq("public_slug", publicSlug)
    .maybeSingle();
  expect(buildingError).toBeNull();
  expect(building).not.toBeNull();

  const { data: members, error: memberError } = await anon
    .from("building_memberships")
    .select(
      "stores!inner(id, slug, name, category, logo_url, order_count_week, created_at)"
    )
    .eq("building_id", buildingId)
    .eq("status", "active");
  expect(memberError).toBeNull();

  return { building, members: members ?? [] };
}

beforeAll(async () => {
  const tag = `${Date.now()}`;
  sellerA = await seedSeller(service, { slug: `bazaar-a-${tag}` });
  sellerB = await seedSeller(service, { slug: `bazaar-b-${tag}` });
  qrOnly = await seedSeller(service, { slug: `bazaar-qr-${tag}` });

  const normalizedKey = "120 maple st|M5V2T6";
  await service
    .from("stores")
    .update({ visibility: "building", normalized_key: normalizedKey })
    .in("id", [sellerA.storeId, sellerB.storeId]);
  await service
    .from("stores")
    .update({ visibility: "qr_only", normalized_key: normalizedKey })
    .eq("id", qrOnly.storeId);

  await service
    .from("sellers")
    .update({
      contact_address: "120 Maple St, Unit 1901, Toronto, ON M5V 2T6",
      contact_phone_e164: "+14155550100"
    })
    .in("id", [sellerA.sellerId, sellerB.sellerId, qrOnly.sellerId]);
  await service
    .from("stores")
    .update({ pickup_private_note: "Unit 1901 after order." })
    .in("id", [sellerA.storeId, sellerB.storeId, qrOnly.storeId]);

  await sync(sellerA.storeId);
  await sync(sellerB.storeId);
  await sync(qrOnly.storeId);

  const { data: membership, error } = await service
    .from("building_memberships")
    .select("building_id, buildings(public_slug)")
    .eq("store_id", sellerA.storeId)
    .single();
  if (error || !membership?.building_id || !membership.buildings?.public_slug) {
    throw new Error(`building fixture failed: ${error?.message ?? "missing row"}`);
  }
  buildingId = membership.building_id;
  publicSlug = membership.buildings.public_slug;
});

afterAll(async () => {
  await cleanupUser(service, sellerA.userId);
  await cleanupUser(service, sellerB.userId);
  await cleanupUser(service, qrOnly.userId);
  if (buildingId) {
    await service.from("buildings").delete().eq("id", buildingId);
  }
});

describe("public bazaar privacy", () => {
  it("returns opted-in building mates without PII or unit details", async () => {
    const payload = await publicBazaarPayload();
    const serialized = JSON.stringify(payload).toLowerCase();

    expect(payload.members).toHaveLength(2);
    expect(serialized).toContain(sellerA.slug);
    expect(serialized).toContain(sellerB.slug);
    expect(serialized).not.toContain(qrOnly.slug);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("+14155550100");
    expect(serialized).not.toMatch(/\b(apt|apartment|unit|suite|#|1901)\b/);
    expect(serialized).not.toContain("120 maple");
    expect(serialized).not.toContain("m5v2t6");
  });

  it("keeps qr-only stores out after repeat grouping runs", async () => {
    await sync(sellerA.storeId);
    await sync(sellerB.storeId);
    await sync(qrOnly.storeId);

    const { data: activeRows, error } = await service
      .from("building_memberships")
      .select("store_id")
      .eq("building_id", buildingId)
      .eq("status", "active");
    expect(error).toBeNull();
    expect((activeRows ?? []).map((row) => row.store_id).sort()).toEqual(
      [sellerA.storeId, sellerB.storeId].sort()
    );
  });

  it("returns bounded buyable product highlights from SQL", async () => {
    const { error: productSeedError } = await service.from("products").insert([
      {
        store_id: sellerA.storeId,
        name: "Sold out cake",
        price_cents: 1200,
        qty_available: 0
      },
      {
        store_id: sellerA.storeId,
        name: "Fresh tart",
        price_cents: 900,
        qty_available: 3
      },
      {
        store_id: sellerB.storeId,
        name: "Fresh soap",
        price_cents: 700,
        qty_available: null
      }
    ]);
    expect(productSeedError).toBeNull();

    const { data: highlights, error } = await service.rpc(
      "get_building_product_highlights",
      {
        p_building_id: buildingId,
        p_drop_limit: 1
      }
    );
    expect(error).toBeNull();

    const rows = highlights ?? [];
    expect(rows.filter((row) => row.section === "drop")).toHaveLength(1);
    expect(
      rows
        .filter((row) => row.section === "top")
        .map((row) => row.store_id)
        .sort()
    ).toEqual([sellerA.storeId, sellerB.storeId].sort());
    expect(JSON.stringify(rows).toLowerCase()).toContain("fresh tart");
    expect(JSON.stringify(rows).toLowerCase()).not.toContain("sold out cake");
  });

  it("keeps invite-only bazaars out of raw anon building and membership reads", async () => {
    const { error } = await service
      .from("buildings")
      .update({
        access_type: "invite",
        invite_code: "ABCDEFGH",
        invite_code_rotated_at: new Date().toISOString()
      })
      .eq("id", buildingId);
    expect(error).toBeNull();

    const { data: building, error: buildingError } = await anon
      .from("buildings")
      .select("id, display_name, city, public_slug, access_type, created_at")
      .eq("public_slug", publicSlug)
      .maybeSingle();
    expect(buildingError).toBeNull();
    expect(building).toBeNull();

    const { data: members, error: memberError } = await anon
      .from("building_memberships")
      .select(
        "building_id, stores!inner(id, slug, name, category, logo_url, order_count_week, created_at)"
      )
      .eq("building_id", buildingId)
      .eq("status", "active");
    expect(memberError).toBeNull();
    expect(members ?? []).toHaveLength(0);

    const serialized = JSON.stringify({ building, members }).toLowerCase();
    expect(serialized).not.toContain("abcdefgh");
    expect(serialized).not.toContain("invite_code");
    expect(serialized).not.toContain("invite_code_rotated_at");
  });
});
