import { z } from "zod";

// Phase 10.6 / scale follow-up: the founder-dashboard shape plus the parser that validates the
// get_admin_metrics RPC payload (migration 0040). The aggregation itself now runs in Postgres so the
// Worker never folds the full paid-orders table in memory; this file is the typed boundary between
// that JSON document and the dashboard. Pulls in no server-only modules so it can be unit-tested
// under jsdom; the service-role call that feeds it lives in `./load-metrics` (server-only).

export interface TopSeller {
  sellerId: string;
  name: string;
  gmvCents: number;
  orderCount: number;
}

export interface TopBuilding {
  buildingId: string;
  name: string;
  gmvCents: number;
  orderCount: number;
}

export interface AdminMetrics {
  storeCount: number;
  productCount: number;
  paidOrderCount: number;
  gmvCents: number;
  platformFeesCents: number;
  topSellers: TopSeller[];
  topBuildings: TopBuilding[];
}

const count = z.number().int().nonnegative();
const cents = z.number().int().nonnegative();

const topSellerRowSchema = z.object({
  seller_id: z.string(),
  name: z.string(),
  gmv_cents: cents,
  order_count: count
});

const topBuildingRowSchema = z.object({
  building_id: z.string(),
  name: z.string(),
  gmv_cents: cents,
  order_count: count
});

// The raw JSON document returned by public.get_admin_metrics. Validated here so a shape drift fails
// loudly at the boundary instead of rendering wrong money on the founder dashboard.
const adminMetricsRowSchema = z.object({
  store_count: count,
  product_count: count,
  paid_order_count: count,
  gmv_cents: cents,
  platform_fees_cents: cents,
  top_sellers: z.array(topSellerRowSchema),
  top_buildings: z.array(topBuildingRowSchema)
});

export function parseAdminMetrics(payload: unknown): AdminMetrics {
  const row = adminMetricsRowSchema.parse(payload);
  return {
    storeCount: row.store_count,
    productCount: row.product_count,
    paidOrderCount: row.paid_order_count,
    gmvCents: row.gmv_cents,
    platformFeesCents: row.platform_fees_cents,
    topSellers: row.top_sellers.map((s) => ({
      sellerId: s.seller_id,
      name: s.name,
      gmvCents: s.gmv_cents,
      orderCount: s.order_count
    })),
    topBuildings: row.top_buildings.map((b) => ({
      buildingId: b.building_id,
      name: b.name,
      gmvCents: b.gmv_cents,
      orderCount: b.order_count
    }))
  };
}
