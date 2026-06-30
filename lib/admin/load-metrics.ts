import "server-only";

import { parseAdminMetrics, type AdminMetrics } from "@/lib/admin/metrics";
import { PLATFORM_FEE_BPS } from "@/lib/pricing/fee";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

// Phase 10.6 / scale follow-up: the service-role fetch behind the founder dashboard. Aggregation runs
// in Postgres (public.get_admin_metrics, migration 0040) so this loader stays O(1) in memory no matter
// how many paid orders exist — it passes the platform-fee rate down and validates the JSON it gets
// back. The RPC is granted to service_role only, so the secret client is required.
const ADMIN_TOP_LIMIT = 10;

export async function loadAdminMetrics(): Promise<AdminMetrics> {
  const supabase = createSupabaseSecretClient();

  const { data, error } = await supabase.rpc("get_admin_metrics", {
    p_fee_bps: PLATFORM_FEE_BPS,
    p_top_limit: ADMIN_TOP_LIMIT
  });
  if (error) {
    throw new Error(`Failed to load admin metrics: ${error.message}`);
  }

  return parseAdminMetrics(data);
}
