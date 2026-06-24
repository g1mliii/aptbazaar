import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { StoreClosed } from "@/app/components/storefront/store-closed";
import type {
  StorefrontProduct,
  StorefrontStore
} from "@/app/components/storefront/types";
import { storeChargesEnabled } from "@/lib/stripe/connected-account";
import { createSupabaseAnonClient } from "@/lib/supabase/anon";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { isTestSupabaseConfigError } from "@/lib/supabase/test-config";

import { Storefront } from "./storefront";

// Phase 4.1: public storefront. Phone-first. Short revalidate keeps it edge-cacheable while a
// seller's edits show up quickly.
export const revalidate = 30;

// Explicit, non-PII column lists. The public storefront never selects seller email/phone/address
// or any unit number (hard invariant 2 + the Phase 4 privacy gate).
const STORE_COLUMNS =
  "id, slug, name, category, description, logo_url, is_active, pickup_method, pickup_window_label, pickup_public_note, accept_pay_at_pickup, order_count_week";
const PRODUCT_COLUMNS =
  "id, name, description, price_cents, image_url, qty_available, allergens";

type StoreActiveRow = Omit<StorefrontStore, never> & { is_active: boolean };

// Happy path reads through the anon client so RLS stays load-bearing — it returns the store only
// when it's active, and only its active products. Wrapped in cache() so generateMetadata and the
// page render share one set of queries per request (supabase-js calls aren't auto-deduped like
// fetch()). A query *error* is thrown, not swallowed: a transient read failure must not be
// mistaken for "no active store" (which would render the closed-store fallback for a live store).
const loadActiveStore = cache(async function loadActiveStore(
  slug: string
): Promise<{ store: StorefrontStore; products: StorefrontProduct[] } | null> {
  let supabase: ReturnType<typeof createSupabaseAnonClient>;
  try {
    supabase = createSupabaseAnonClient();
  } catch (error) {
    if (isTestSupabaseConfigError(error)) {
      return null;
    }
    throw error;
  }
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select(STORE_COLUMNS)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle<StoreActiveRow>();
  if (storeError) throw storeError;
  if (!store) return null;

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("store_id", store.id)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .returns<StorefrontProduct[]>();
  if (productsError) throw productsError;

  return { store, products: products ?? [] };
});

// Phase 8.3: building-mates for the "Also available in this building" row. A store appears in a
// bazaar only when it has an active membership (qr_only stores never do), so membership presence is
// the opt-in signal — no need to read the store's visibility. anon RLS keeps this to active members
// of the same building and never returns any PII. Returns null for qr_only / solo buildings so the
// section is omitted entirely.
export interface BuildingMate {
  slug: string;
  name: string;
  category: string | null;
  logo_url: string | null;
}

const loadBuildingMates = cache(async function loadBuildingMates(
  storeId: string
): Promise<{ buildingSlug: string; mates: BuildingMate[] } | null> {
  let supabase: ReturnType<typeof createSupabaseAnonClient>;
  try {
    supabase = createSupabaseAnonClient();
  } catch (error) {
    if (isTestSupabaseConfigError(error)) {
      return null;
    }
    throw error;
  }

  const { data: membership } = await supabase
    .from("building_memberships")
    .select("building_id, buildings(public_slug)")
    .eq("store_id", storeId)
    .eq("status", "active")
    .maybeSingle();
  const buildingSlug = membership?.buildings?.public_slug;
  if (!membership?.building_id || !buildingSlug) {
    return null;
  }

  const { data: mateRows } = await supabase
    .from("building_memberships")
    .select("stores!inner(slug, name, category, logo_url)")
    .eq("building_id", membership.building_id)
    .eq("status", "active")
    .neq("store_id", storeId)
    .limit(5);

  const mates = (mateRows ?? [])
    .map((row) => row.stores)
    .filter((store): store is NonNullable<typeof store> => Boolean(store))
    .map((store) => ({
      slug: store.slug,
      name: store.name,
      category: store.category,
      logo_url: store.logo_url
    }));

  if (mates.length === 0) {
    return null;
  }
  return { buildingSlug, mates };
});

// Fallback only to tell "closed" from "never existed": anon RLS hides inactive stores entirely,
// so a server-only existence probe picks the right copy. Selects no PII. If the probe itself
// fails, degrade to "not found" (404) rather than surfacing a 500. cache()'d alongside the active
// loader so the metadata + render passes don't double-probe.
const loadInactiveStore = cache(async function loadInactiveStore(
  slug: string
): Promise<StorefrontStore | null> {
  try {
    const supabase = createSupabaseSecretClient();
    const { data } = await supabase
      .from("stores")
      .select(STORE_COLUMNS)
      .eq("slug", slug)
      .maybeSingle<StoreActiveRow>();
    return data ?? null;
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const active = await loadActiveStore(slug);
    const name = active?.store.name ?? (await loadInactiveStore(slug))?.name;
    return { title: name ? `${name} · Stoop` : "Stoop" };
  } catch {
    // A transient read shouldn't fail metadata generation; the page render surfaces the error.
    return { title: "Stoop" };
  }
}

export default async function StorefrontPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const active = await loadActiveStore(slug);
  if (active) {
    // Whether to offer the "Pay online" path. Read server-side via the secret client because
    // connected_accounts is service-role only and never reaches a public surface.
    const [onlineReady, buildingMates] = await Promise.all([
      storeChargesEnabled(active.store.id),
      loadBuildingMates(active.store.id)
    ]);
    return (
      <Storefront
        buildingMates={buildingMates}
        onlineReady={onlineReady}
        products={active.products}
        store={active.store}
      />
    );
  }

  const inactive = await loadInactiveStore(slug);
  if (inactive) {
    return <StoreClosed store={inactive} />;
  }

  notFound();
}
