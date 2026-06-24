import { getSeller } from "@/lib/auth/session";
import { selectActiveBuilding } from "@/lib/queries/building-membership";
import { getConnectedAccount } from "@/lib/stripe/connected-account";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { SettingsScreen } from "./settings-screen";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const seller = await getSeller();

  const { data: store } = await supabase
    .from("stores")
    .select(
      "id, slug, name, category, description, logo_url, visibility, pickup_method, pickup_window_label, pickup_public_note, accept_pay_at_pickup, is_active"
    )
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // connected_accounts is service-role only, so the user-scoped client would always read null.
  // getConnectedAccount goes through the secret client (scoped to the authenticated seller).
  let stripeReady = false;
  if (seller) {
    const connected = await getConnectedAccount(seller.id);
    stripeReady = connected?.charges_enabled ?? false;
  }

  // The building the seller belongs to, if any. RLS (buildings_member_select) lets a member read the
  // full row including the shared invite_code, so the admin block can show / rotate it.
  let building: {
    public_slug: string;
    display_name: string;
    access_type: "open" | "invite";
    invite_code: string | null;
  } | null = null;
  if (store) {
    const { data: membership } = await selectActiveBuilding(supabase, store.id);
    building = membership?.buildings ?? null;
  }

  if (!store || !seller) {
    return (
      <section className="mx-auto max-w-2xl">
        <h1 className="font-display text-36 leading-none text-ink">Settings</h1>
        <p className="mt-2 text-15 text-ink-2">Your stoop is still being set up.</p>
      </section>
    );
  }

  return (
    <SettingsScreen
      store={store}
      building={building}
      contact={{
        display_name: seller.display_name,
        contact_email: seller.contact_email,
        contact_phone_e164: seller.contact_phone_e164,
        contact_address: seller.contact_address
      }}
      stripeReady={stripeReady}
    />
  );
}
