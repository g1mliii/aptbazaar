import { computePlatformFee } from "@/lib/pricing/fee";

// Phase 10.6: pure founder-dashboard aggregation. All the math lives here so it can be unit-tested
// against hand-built rows (the 10.6 regression: counts match independent queries). This file pulls
// in no server-only modules so the test can import it under jsdom; the service-role fetch that feeds
// it lives in `./load-metrics` (server-only). At MVP scale (tens of sellers, hundreds of orders)
// folding paid rows in JS is cheap and avoids a new RPC + RLS surface; revisit with a snapshot/RPC
// if order volume grows.

const TOP_LIMIT = 10;

export interface PaidOrderRow {
  store_id: string;
  total_cents: number;
}

export interface StoreRow {
  id: string;
  seller_id: string;
}

export interface SellerRow {
  id: string;
  display_name: string;
}

export interface MembershipRow {
  building_id: string;
  store_id: string;
}

export interface BuildingRow {
  id: string;
  display_name: string;
}

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

export interface AdminMetricsInput {
  storeCount: number;
  productCount: number;
  paidOrders: PaidOrderRow[];
  stores: StoreRow[];
  sellers: SellerRow[];
  memberships: MembershipRow[];
  buildings: BuildingRow[];
}

export function computeAdminMetrics(input: AdminMetricsInput): AdminMetrics {
  const { paidOrders, stores, sellers, memberships, buildings } = input;

  const sellerOfStore = new Map(stores.map((s) => [s.id, s.seller_id]));
  const sellerName = new Map(sellers.map((s) => [s.id, s.display_name]));
  const buildingOfStore = new Map(memberships.map((m) => [m.store_id, m.building_id]));
  const buildingName = new Map(buildings.map((b) => [b.id, b.display_name]));

  let gmvCents = 0;
  let platformFeesCents = 0;
  const sellerTotals = new Map<string, { gmvCents: number; orderCount: number }>();
  const buildingTotals = new Map<string, { gmvCents: number; orderCount: number }>();

  for (const order of paidOrders) {
    gmvCents += order.total_cents;
    // Per-order fee, summed — matches what Stripe took on each charge. Never re-derive the %.
    platformFeesCents += computePlatformFee(order.total_cents);

    const sellerId = sellerOfStore.get(order.store_id);
    if (sellerId) {
      const acc = sellerTotals.get(sellerId) ?? { gmvCents: 0, orderCount: 0 };
      acc.gmvCents += order.total_cents;
      acc.orderCount += 1;
      sellerTotals.set(sellerId, acc);
    }

    const buildingId = buildingOfStore.get(order.store_id);
    if (buildingId) {
      const acc = buildingTotals.get(buildingId) ?? { gmvCents: 0, orderCount: 0 };
      acc.gmvCents += order.total_cents;
      acc.orderCount += 1;
      buildingTotals.set(buildingId, acc);
    }
  }

  const topSellers: TopSeller[] = [...sellerTotals.entries()]
    .map(([sellerId, t]) => ({
      sellerId,
      name: sellerName.get(sellerId) ?? "Unknown seller",
      gmvCents: t.gmvCents,
      orderCount: t.orderCount
    }))
    .sort((a, b) => b.gmvCents - a.gmvCents)
    .slice(0, TOP_LIMIT);

  const topBuildings: TopBuilding[] = [...buildingTotals.entries()]
    .map(([buildingId, t]) => ({
      buildingId,
      name: buildingName.get(buildingId) ?? "Unknown building",
      gmvCents: t.gmvCents,
      orderCount: t.orderCount
    }))
    .sort((a, b) => b.gmvCents - a.gmvCents)
    .slice(0, TOP_LIMIT);

  return {
    storeCount: input.storeCount,
    productCount: input.productCount,
    paidOrderCount: paidOrders.length,
    gmvCents,
    platformFeesCents,
    topSellers,
    topBuildings
  };
}
