import "server-only";

import { redirect } from "next/navigation";

import { sellerRowSchema, type Seller } from "@/lib/schemas/seller";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 2.7: session helpers for protected seller routes. getUser() (not getSession())
// validates the JWT with Supabase, so this is safe to gate authorization on.

export async function getSeller(): Promise<Seller | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("sellers")
    // Explicit columns, never `select *` against a PII table (hard invariant 6).
    .select(
      "id, user_id, display_name, contact_email, contact_phone_e164, contact_address, created_at"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return sellerRowSchema.parse(data);
}

/** Redirects to /login when the visitor isn't a signed-in seller. */
export async function requireSeller(): Promise<Seller> {
  const seller = await getSeller();
  if (!seller) {
    // /login is built in Phase 3; cast past typed-routes until the route literal exists.
    redirect("/login" as Parameters<typeof redirect>[0]);
  }
  return seller;
}
