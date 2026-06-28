import "server-only";

import { computeAdminMetrics, type AdminMetrics } from "@/lib/admin/metrics";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

// Phase 10.6: the service-role fetch behind the founder dashboard. Reads go through the secret
// client because the founder needs a cross-tenant view that RLS would otherwise scope to one seller.
// All aggregation lives in the pure `computeAdminMetrics` (./metrics) so this file is a thin loader.
export async function loadAdminMetrics(): Promise<AdminMetrics> {
  const supabase = createSupabaseSecretClient();

  const [
    storeCountRes,
    productCountRes,
    paidOrdersRes,
    storesRes,
    sellersRes,
    membershipsRes,
    buildingsRes
  ] = await Promise.all([
    supabase.from("stores").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("orders").select("store_id, total_cents").eq("payment_status", "paid"),
    supabase.from("stores").select("id, seller_id"),
    supabase.from("sellers").select("id, display_name"),
    supabase.from("building_memberships").select("building_id, store_id").eq("status", "active"),
    supabase.from("buildings").select("id, display_name")
  ]);

  return computeAdminMetrics({
    storeCount: storeCountRes.count ?? 0,
    productCount: productCountRes.count ?? 0,
    paidOrders: paidOrdersRes.data ?? [],
    stores: storesRes.data ?? [],
    sellers: sellersRes.data ?? [],
    memberships: membershipsRes.data ?? [],
    buildings: buildingsRes.data ?? []
  });
}
