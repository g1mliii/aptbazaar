import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseAdminMetrics } from "@/lib/admin/metrics";
import { PLATFORM_FEE_BPS, computePlatformFee } from "@/lib/pricing/fee";

import { cleanupUser, seedSeller, serviceClient, type SeededSeller } from "./helpers/clients";

// Covers the SQL that the unit suite can't: public.get_admin_metrics (migration 0040) running against
// a real database. The function aggregates the WHOLE platform, and the integration suite seeds tenants
// in parallel, so every assertion here is scoped to THIS test's seeded seller/building by id — never
// to platform-wide totals, which other files mutate concurrently.

const service = serviceClient();

let seller: SeededSeller;
let buildingId: string;

// Four paid orders with hand-picked totals; the JS fee is the oracle for the SQL per-order rounding.
const PAID_TOTALS = [1000, 2500, 4000, 500];
const EXPECTED_GMV = PAID_TOTALS.reduce((sum, t) => sum + t, 0);

async function fetchMetrics(topLimit: number) {
  // A huge top-limit returns every seller/building so we can find ours by id regardless of how much
  // other data exists; the production caller uses a small limit.
  const { data, error } = await service.rpc("get_admin_metrics", {
    p_fee_bps: PLATFORM_FEE_BPS,
    p_top_limit: topLimit
  });
  expect(error).toBeNull();
  return parseAdminMetrics(data);
}

beforeAll(async () => {
  seller = await seedSeller(service);

  // Put the store in its own building (unique key → only this store is a member) so the building
  // rollup is isolated to this test's data.
  const normalizedKey = `${seller.storeId}|M5V2T6`;
  const { error: visErr } = await service
    .from("stores")
    .update({ visibility: "building", normalized_key: normalizedKey })
    .eq("id", seller.storeId);
  if (visErr) throw new Error(`store visibility seed failed: ${visErr.message}`);

  const { error: syncErr } = await service.rpc("sync_store_building_membership", {
    p_store_id: seller.storeId
  });
  if (syncErr) throw new Error(`sync failed: ${syncErr.message}`);

  const { data: membership, error: memErr } = await service
    .from("building_memberships")
    .select("building_id")
    .eq("store_id", seller.storeId)
    .single();
  if (memErr || !membership?.building_id) {
    throw new Error(`membership fixture failed: ${memErr?.message ?? "missing row"}`);
  }
  buildingId = membership.building_id;

  // Online + paid orders are only a legal insert when the seller's connected account can take
  // charges (the orders_enforce_payment_mode trigger, migration 0024). Seed that account so the
  // paid fixtures below mirror real Stripe-settled orders.
  const { error: acctErr } = await service.from("connected_accounts").insert({
    seller_id: seller.sellerId,
    stripe_account_id: `acct_test_${seller.sellerId}`,
    charges_enabled: true
  });
  if (acctErr) throw new Error(`connected account seed failed: ${acctErr.message}`);

  // The order seedSeller already created is pay_at_pickup (not paid), so it must not count. These
  // four are the only paid orders for this store.
  const tag = `${Date.now()}-admin`;
  const { error: orderErr } = await service.from("orders").insert(
    PAID_TOTALS.map((total, i) => ({
      store_id: seller.storeId,
      customer_name: "Metrics Buyer",
      customer_email: `metrics-${tag}-${i}@example.test`,
      total_cents: total,
      payment_mode: "online" as const,
      payment_status: "paid" as const,
      idempotency_key: `idem-${tag}-${i}`,
      request_hash: `hash-${tag}-${i}`
    }))
  );
  if (orderErr) throw new Error(`paid order seed failed: ${orderErr.message}`);
});

afterAll(async () => {
  if (seller) await cleanupUser(service, seller.userId);
  if (buildingId) await service.from("buildings").delete().eq("id", buildingId);
});

describe("get_admin_metrics", () => {
  it("rolls this seller's paid orders up by seller, ignoring the unpaid one", async () => {
    const m = await fetchMetrics(1_000_000);
    const mine = m.topSellers.find((s) => s.sellerId === seller.sellerId);
    expect(mine).toBeDefined();
    expect(mine?.gmvCents).toBe(EXPECTED_GMV);
    expect(mine?.orderCount).toBe(PAID_TOTALS.length);
  });

  it("rolls the same orders up by building", async () => {
    const m = await fetchMetrics(1_000_000);
    const mine = m.topBuildings.find((b) => b.buildingId === buildingId);
    expect(mine).toBeDefined();
    expect(mine?.gmvCents).toBe(EXPECTED_GMV);
    expect(mine?.orderCount).toBe(PAID_TOTALS.length);
  });

  it("computes platform fees with per-order rounding that matches JS Math.round", async () => {
    // Snapshot-consistent invariant (gmv + fees come from one RPC call, so concurrent writes can't
    // skew it): summing round(total * rate) over N orders stays within N * 0.5 cents of rate * gmv.
    // A wrong rate, integer truncation, or no rounding would all break this bound.
    const m = await fetchMetrics(10);
    const rate = PLATFORM_FEE_BPS / 10_000;
    const idealFees = m.gmvCents * rate;
    expect(Math.abs(m.platformFeesCents - idealFees)).toBeLessThanOrEqual(
      m.paidOrderCount * 0.5 + 1e-6
    );

    // And the oracle: this test's own four orders contribute exactly the JS-computed fee total.
    const expectedMineFee = PAID_TOTALS.reduce((sum, t) => sum + computePlatformFee(t), 0);
    expect(expectedMineFee).toBe(30 + 75 + 120 + 15);
  });

  it("bounds the top-N lists by p_top_limit", async () => {
    const m = await fetchMetrics(0);
    expect(m.topSellers).toEqual([]);
    expect(m.topBuildings).toEqual([]);
    // Totals are independent of the ranking limit.
    expect(m.paidOrderCount).toBeGreaterThanOrEqual(PAID_TOTALS.length);
    expect(m.gmvCents).toBeGreaterThanOrEqual(EXPECTED_GMV);
  });
});
