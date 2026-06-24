import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

// The active building a store is publicly grouped into. The "status = active" opt-in rule and the
// membership→building join are a single domain concept, used by the settings page, the QR download
// route, and the invite-admin action — keep them reading it the same way from one place. Returns the
// raw { data, error } so callers can still distinguish a query failure from "not grouped yet".
export function selectActiveBuilding(
  supabase: SupabaseClient<Database>,
  storeId: string
) {
  return supabase
    .from("building_memberships")
    .select(
      "building_id, buildings(public_slug, display_name, access_type, invite_code)"
    )
    .eq("store_id", storeId)
    .eq("status", "active")
    .maybeSingle();
}
