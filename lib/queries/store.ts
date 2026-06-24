import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

// The seller's primary store id (their earliest-created store). Resolved under the caller's JWT, so
// RLS scopes it to stores they own. Shared by the settings mutations and the building-admin actions.
export async function selectPrimaryStoreId(
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  const { data } = await supabase
    .from("stores")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
