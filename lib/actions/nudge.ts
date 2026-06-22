"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { NUDGE_DISMISSED_COOKIE } from "@/lib/cookie-names";
import { uuid } from "@/lib/schemas/common";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 3.7: dismissal of the "print your QR" onboarding nudge. Persisted in a cookie (there was
// no scan-tracking column before Phase 7); the Orders page reads it server-side so there's no
// hydration flash.

export async function dismissNudge(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(NUDGE_DISMISSED_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
  revalidatePath("/dashboard/orders");
}

// Phase 7.5: the first-scan ceremony shows the "First scan!" seal exactly once. The Orders page
// renders it when first_scan_at is stamped but first_scan_seen_at isn't; this records that the
// seller has seen it (RLS scopes the update to their own store), so the next load won't re-fire.
export async function markFirstScanSeen(storeId: string): Promise<void> {
  const parsed = uuid.safeParse(storeId);
  if (!parsed.success) return;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("stores")
    .update({ first_scan_seen_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .not("first_scan_at", "is", null)
    .is("first_scan_seen_at", null);

  revalidatePath("/dashboard/orders");
}
