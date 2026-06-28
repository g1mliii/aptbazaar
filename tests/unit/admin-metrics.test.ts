import { describe, expect, it } from "vitest";

import { computeAdminMetrics, type AdminMetricsInput } from "@/lib/admin/metrics";
import { computePlatformFee } from "@/lib/pricing/fee";

// Phase 10.6 regression: the dashboard aggregates must equal what an independent pass over the same
// rows produces. We build rows by hand, fold them with computeAdminMetrics, and assert against
// totals computed a second, simpler way.

const baseInput: AdminMetricsInput = {
  storeCount: 3,
  productCount: 12,
  paidOrders: [
    { store_id: "store-a", total_cents: 1000 },
    { store_id: "store-a", total_cents: 2500 },
    { store_id: "store-b", total_cents: 4000 },
    { store_id: "store-c", total_cents: 500 }
  ],
  stores: [
    { id: "store-a", seller_id: "seller-1" },
    { id: "store-b", seller_id: "seller-1" },
    { id: "store-c", seller_id: "seller-2" }
  ],
  sellers: [
    { id: "seller-1", display_name: "Priya's Kitchen" },
    { id: "seller-2", display_name: "Sam's Candles" }
  ],
  memberships: [
    { building_id: "bldg-1", store_id: "store-a" },
    { building_id: "bldg-1", store_id: "store-b" },
    { building_id: "bldg-2", store_id: "store-c" }
  ],
  buildings: [
    { id: "bldg-1", display_name: "12 Maple" },
    { id: "bldg-2", display_name: "5 Oak" }
  ]
};

describe("computeAdminMetrics", () => {
  it("passes through the head counts", () => {
    const m = computeAdminMetrics(baseInput);
    expect(m.storeCount).toBe(3);
    expect(m.productCount).toBe(12);
    expect(m.paidOrderCount).toBe(4);
  });

  it("sums GMV and platform fees independently", () => {
    const m = computeAdminMetrics(baseInput);
    const expectedGmv = baseInput.paidOrders.reduce((sum, o) => sum + o.total_cents, 0);
    const expectedFees = baseInput.paidOrders.reduce(
      (sum, o) => sum + computePlatformFee(o.total_cents),
      0
    );
    expect(m.gmvCents).toBe(expectedGmv);
    expect(m.platformFeesCents).toBe(expectedFees);
  });

  it("ranks sellers by revenue with order counts", () => {
    const m = computeAdminMetrics(baseInput);
    // seller-1 = store-a (1000 + 2500) + store-b (4000) = 7500 over 3 orders.
    // seller-2 = store-c (500) over 1 order.
    expect(m.topSellers).toEqual([
      { sellerId: "seller-1", name: "Priya's Kitchen", gmvCents: 7500, orderCount: 3 },
      { sellerId: "seller-2", name: "Sam's Candles", gmvCents: 500, orderCount: 1 }
    ]);
  });

  it("ranks buildings by activity with order counts", () => {
    const m = computeAdminMetrics(baseInput);
    // bldg-1 = store-a + store-b = 7500 over 3 orders; bldg-2 = store-c = 500 over 1 order.
    expect(m.topBuildings).toEqual([
      { buildingId: "bldg-1", name: "12 Maple", gmvCents: 7500, orderCount: 3 },
      { buildingId: "bldg-2", name: "5 Oak", gmvCents: 500, orderCount: 1 }
    ]);
  });

  it("ignores orders whose store has no seller or building mapping", () => {
    const m = computeAdminMetrics({
      ...baseInput,
      paidOrders: [{ store_id: "ghost-store", total_cents: 9999 }]
    });
    // GMV still counts the order, but it lands in no seller/building bucket.
    expect(m.gmvCents).toBe(9999);
    expect(m.topSellers).toEqual([]);
    expect(m.topBuildings).toEqual([]);
  });

  it("returns empty rankings and zero money with no paid orders", () => {
    const m = computeAdminMetrics({ ...baseInput, paidOrders: [] });
    expect(m.gmvCents).toBe(0);
    expect(m.platformFeesCents).toBe(0);
    expect(m.paidOrderCount).toBe(0);
    expect(m.topSellers).toEqual([]);
    expect(m.topBuildings).toEqual([]);
  });
});
