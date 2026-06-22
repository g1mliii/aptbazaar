import "server-only";

import { writeAuditLog } from "@/lib/audit/log";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { isGeneratedToken } from "@/lib/utils/token";

// Phase 6.5: the one-click unsubscribe path. The token is the bearer credential — there's no seller
// session here — so this always runs through the service-role client and updates by token. No new
// RLS policy is needed. The actual unsubscribe (`unsubscribeByToken`) is a state change, so it only
// runs on a real POST — the RFC 8058 one-click endpoint and the confirm button on the landing page.
// It's idempotent (a no-op if already unsubscribed) and audit-logs only the first, real unsubscribe
// so a re-POST or a refresh doesn't spam the audit trail. `findUnsubscribeTarget` is the read-only
// peek the GET landing page renders, so a link scanner or prefetch that follows the body link never
// unsubscribes anyone. Only the store's display name + slug leave this module — never a unit number
// or other PII.

type LoadedTarget = {
  subscriber: { id: string; store_id: string; unsubscribed_at: string | null };
  store: { name: string; slug: string };
};

type LoadResult =
  | { ok: true; target: LoadedTarget | null }
  | { ok: false; reason: "read_failed" };

async function loadByToken(token: string): Promise<LoadResult> {
  if (!isGeneratedToken(token)) return { ok: true, target: null };

  const supabase = createSupabaseSecretClient();

  // One round-trip: the store rides along the subscribers_store_id_fkey embed (service-role client,
  // so RLS doesn't block it).
  const { data, error } = await supabase
    .from("subscribers")
    .select("id, store_id, unsubscribed_at, stores(name, slug)")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (error) return { ok: false, reason: "read_failed" };
  if (!data || !data.stores) return { ok: true, target: null };

  const { stores, ...subscriber } = data;
  return { ok: true, target: { subscriber, store: stores } };
}

export type UnsubscribeTarget =
  | { ok: true; storeName: string; storeSlug: string; alreadyUnsubscribed: boolean }
  | { ok: false };

/** Read-only lookup for the GET landing page. Never writes, so scanners/prefetches are harmless. */
export async function findUnsubscribeTarget(token: string): Promise<UnsubscribeTarget> {
  const loaded = await loadByToken(token);
  if (!loaded.ok || !loaded.target) return { ok: false };
  return {
    ok: true,
    storeName: loaded.target.store.name,
    storeSlug: loaded.target.store.slug,
    alreadyUnsubscribed: loaded.target.subscriber.unsubscribed_at !== null
  };
}

export type UnsubscribeResult =
  | { ok: true; storeName: string; storeSlug: string }
  | { ok: false; reason: "not_found" | "write_failed" };

export async function unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
  const loaded = await loadByToken(token);
  if (!loaded.ok) return { ok: false, reason: "write_failed" };
  if (!loaded.target) return { ok: false, reason: "not_found" };
  const { subscriber, store } = loaded.target;

  // Only the first unsubscribe writes + audits; a re-click or refresh is a true no-op.
  if (!subscriber.unsubscribed_at) {
    const supabase = createSupabaseSecretClient();
    const { data, error } = await supabase
      .from("subscribers")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("id", subscriber.id)
      .is("unsubscribed_at", null)
      .select("id")
      .maybeSingle();
    if (error) {
      return { ok: false, reason: "write_failed" };
    }

    if (data) {
      await writeAuditLog({
        actorType: "anon",
        action: "subscriber.unsubscribed",
        targetTable: "subscribers",
        targetId: subscriber.id
      });
    }
  }

  return { ok: true, storeName: store.name, storeSlug: store.slug };
}
