"use server";

import { fieldErrorsFrom } from "@/lib/schemas/field-errors";
import { subscriberInputSchema } from "@/lib/schemas/subscriber";
import { createSupabaseAnonClient } from "@/lib/supabase/anon";
import { generateToken } from "@/lib/utils/token";

// Phase 4.10: storefront subscriber capture. Anon inserts into `subscribers` for an active store
// (RLS policy subscribers_anon_insert). No phone / SMS in v1. A fresh unsubscribe_token rides
// along so the Phase 6 drop emails can carry a one-click unsubscribe link.
//
// Hard per-(ip, store) rate limiting is Phase 9.3 — the seam is here, not the implementation.

export type SubscribeResult =
  | { ok: true }
  | { ok: false; fieldErrors?: Record<string, string>; error?: string };

export async function subscribe(input: unknown): Promise<SubscribeResult> {
  const parsed = subscriberInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const supabase = createSupabaseAnonClient();
  const { error } = await supabase.from("subscribers").insert({
    store_id: parsed.data.storeId,
    email: parsed.data.email,
    consent_email: parsed.data.consentEmail,
    unsubscribe_token: generateToken()
  });

  // Already on the list (UNIQUE(store_id, email)). Anon can't SELECT subscribers to confirm,
  // so treat a duplicate as success — the visitor's intent is satisfied either way, and we
  // don't reveal whether the address was already captured.
  if (error && error.code !== "23505") {
    return { ok: false, error: "We couldn't add you just now. Try again in a moment." };
  }

  return { ok: true };
}
