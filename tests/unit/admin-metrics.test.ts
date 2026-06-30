import { describe, expect, it } from "vitest";

import { parseAdminMetrics } from "@/lib/admin/metrics";

// Scale follow-up: the founder-dashboard aggregation now runs in Postgres (public.get_admin_metrics,
// migration 0040). The SQL math — GMV, per-order-rounded platform fees, top-N rollups — is covered by
// the integration suite against a live database; here we pin the TypeScript boundary: the RPC's JSON
// document is validated and mapped to the camelCase shape the dashboard renders, and a malformed
// payload fails loudly rather than rendering wrong money.

const validPayload = {
  store_count: 3,
  product_count: 12,
  paid_order_count: 4,
  gmv_cents: 8000,
  platform_fees_cents: 240,
  top_sellers: [
    { seller_id: "seller-1", name: "Priya's Kitchen", gmv_cents: 7500, order_count: 3 },
    { seller_id: "seller-2", name: "Sam's Candles", gmv_cents: 500, order_count: 1 }
  ],
  top_buildings: [
    { building_id: "bldg-1", name: "12 Maple", gmv_cents: 7500, order_count: 3 },
    { building_id: "bldg-2", name: "5 Oak", gmv_cents: 500, order_count: 1 }
  ]
};

describe("parseAdminMetrics", () => {
  it("maps the RPC document to the camelCase dashboard shape", () => {
    const m = parseAdminMetrics(validPayload);
    expect(m).toEqual({
      storeCount: 3,
      productCount: 12,
      paidOrderCount: 4,
      gmvCents: 8000,
      platformFeesCents: 240,
      topSellers: [
        { sellerId: "seller-1", name: "Priya's Kitchen", gmvCents: 7500, orderCount: 3 },
        { sellerId: "seller-2", name: "Sam's Candles", gmvCents: 500, orderCount: 1 }
      ],
      topBuildings: [
        { buildingId: "bldg-1", name: "12 Maple", gmvCents: 7500, orderCount: 3 },
        { buildingId: "bldg-2", name: "5 Oak", gmvCents: 500, orderCount: 1 }
      ]
    });
  });

  it("accepts an empty platform (zero money, no rankings)", () => {
    const m = parseAdminMetrics({
      store_count: 0,
      product_count: 0,
      paid_order_count: 0,
      gmv_cents: 0,
      platform_fees_cents: 0,
      top_sellers: [],
      top_buildings: []
    });
    expect(m.gmvCents).toBe(0);
    expect(m.platformFeesCents).toBe(0);
    expect(m.topSellers).toEqual([]);
    expect(m.topBuildings).toEqual([]);
  });

  it("rejects a malformed payload rather than guessing", () => {
    expect(() => parseAdminMetrics({ store_count: 1 })).toThrow();
    expect(() =>
      parseAdminMetrics({ ...validPayload, gmv_cents: "lots" })
    ).toThrow();
    expect(() => parseAdminMetrics(null)).toThrow();
  });
});
