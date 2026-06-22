import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

// Phase 6.5: the drop audience — every verified, not-yet-unsubscribed subscriber for a store. This
// is the same predicate as the partial index subscribers_store_active_drop_idx. Explicit columns
// only (subscribers is a PII table, hard invariant 6); we need just the address and the unsubscribe
// token to build each one-click link. Takes the client so the seller path can keep RLS load-bearing
// (owner SELECT) while tests can pass a service client.

export type DropRecipient = { email: string; unsubscribe_token: string };

// Dashboard roster ceiling. Counts come from HEAD queries so KPI totals stay correct without
// rendering an unbounded subscriber table into the browser.
export const SUBSCRIBER_LIST_LIMIT = 1000;

export async function countActiveRecipients(
  supabase: SupabaseClient<Database>,
  storeId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .not("verified_at", "is", null)
    .is("unsubscribed_at", null);
  if (error) {
    throw new Error(`Failed to count drop recipients: ${error.message}`);
  }
  return count ?? 0;
}

export async function loadActiveRecipients(
  supabase: SupabaseClient<Database>,
  storeId: string,
  limit = SUBSCRIBER_LIST_LIMIT
): Promise<DropRecipient[]> {
  const { data, error } = await supabase
    .from("subscribers")
    .select("email, unsubscribe_token")
    .eq("store_id", storeId)
    .not("verified_at", "is", null)
    .is("unsubscribed_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to load drop recipients: ${error.message}`);
  }
  return data ?? [];
}
