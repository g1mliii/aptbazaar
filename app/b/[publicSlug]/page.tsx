import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { buildingPublicSchema } from "@/lib/schemas/building";
import { storePublicCardSchema } from "@/lib/schemas/store";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { isTestSupabaseConfigError } from "@/lib/supabase/test-config";
import { bazaarCookieName, verifyBazaarInvite } from "@/lib/utils/bazaar-invite-cookie";
import { PUBLIC_SLUG_RE } from "@/lib/utils/slug";

import { BazaarPage, type BazaarDrop, type BazaarSeller } from "./bazaar";

// Phase 8.2: the public building bazaar. Invite gating reads a cookie, so the page is dynamic. Every
// field that crosses to the client is validated through a public Zod projection — no seller_id,
// email, phone, unit, or full address ever reaches this surface (hard invariants 2 + 6).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Building bazaar · Stoop"
};

type BuildingPageRow = {
  id: string;
  display_name: string;
  city: string | null;
  public_slug: string;
  access_type: "open" | "invite";
  invite_code_rotated_at: string | null;
  created_at: string;
};

type ProductHighlightRow = {
  section: "top" | "drop";
  store_id: string;
  product_id: string;
  product_name: string;
  price_cents: number;
  image_url: string | null;
  qty_available: number | null;
  shop_name: string;
  shop_slug: string;
};

// Invite gate: an invite-only building renders only when the visitor carries a valid, current cookie
// (minted by Proxy after the ?code exchange). Missing building, wrong/expired cookie, and rotated
// code all resolve the same way — notFound() — so a private building can't be enumerated. The gated
// page reads through the secret client after this check because anon RLS intentionally hides
// invite-only building memberships from raw public Supabase reads.
async function loadGatedBuilding(slug: string): Promise<BuildingPageRow | null> {
  const secret = createSupabaseSecretClient();
  const { data: building } = await secret
    .from("buildings")
    .select(
      "id, display_name, city, public_slug, access_type, invite_code_rotated_at, created_at"
    )
    .eq("public_slug", slug)
    .maybeSingle();

  if (!building) {
    return null;
  }
  if (building.access_type !== "invite") {
    return building;
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(bazaarCookieName(slug))?.value;
  const allowed = await verifyBazaarInvite(
    raw,
    slug,
    building.invite_code_rotated_at,
    Date.now()
  );
  return allowed ? building : null;
}

const BAZAAR_CONTENT_REVALIDATE_SECONDS = 30;

// The member roster + drop highlights for one building. Every field here is already the public,
// Zod-projected, PII-free shape (storePublicCardSchema + the highlights RPC): no seller_id, email,
// phone, unit, or address. Pulled out of the page body so open buildings can share one cached read.
async function readBazaarContent(
  buildingId: string
): Promise<{ sellers: BazaarSeller[]; drops: BazaarDrop[] }> {
  const supabase = createSupabaseSecretClient();

  // Active member stores. These explicit filters mirror the grouping RPC so the secret post-gate
  // read cannot accidentally publish qr_only or inactive stores.
  const { data: memberRows, error: memberError } = await supabase
    .from("building_memberships")
    .select(
      "stores!inner(id, slug, name, category, logo_url, order_count_week, created_at)"
    )
    .eq("building_id", buildingId)
    .eq("status", "active")
    .eq("stores.is_active", true)
    .in("stores.visibility", ["building", "nearby"]);
  if (memberError) throw memberError;

  const cards = (memberRows ?? [])
    .map((row) => row.stores)
    .filter((store): store is NonNullable<typeof store> => Boolean(store))
    .map((store) => storePublicCardSchema.parse(store));

  // A building with no active members isn't a public surface yet. Bail before the RPC.
  if (cards.length === 0) {
    return { sellers: [], drops: [] };
  }

  // Top product per store + the tiny "fresh today" row come from SQL. That keeps the page from
  // transferring every active product in a large building only to trim the list in JavaScript.
  const { data: productHighlights, error: productError } = await supabase.rpc(
    "get_building_product_highlights",
    {
      p_building_id: buildingId,
      p_drop_limit: 8
    }
  );
  if (productError) throw productError;

  const highlights = (productHighlights ?? []) as ProductHighlightRow[];
  const byStore = new Map<string, { name: string }>();
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const drops: BazaarDrop[] = [];
  for (const row of highlights) {
    if (row.section === "top") {
      byStore.set(row.store_id, { name: row.product_name });
      continue;
    }

    const shop = cardsById.get(row.store_id);
    if (!shop) {
      continue;
    }
    drops.push({
      id: row.product_id,
      product: row.product_name,
      priceCents: row.price_cents,
      imageUrl: row.image_url,
      shopName: shop.name,
      shopSlug: shop.slug,
      left: row.qty_available
    });
  }

  const sellers: BazaarSeller[] = cards.map((card) => ({
    slug: card.slug,
    name: card.name,
    category: card.category,
    logoUrl: card.logo_url,
    topProduct: byStore.get(card.id)?.name ?? null,
    ordersThisWeek: card.order_count_week
  }));

  return { sellers, drops };
}

// Open buildings only. Their bazaar content is fully public, so a short shared cache turns a viral
// building from one Postgres round-trip per visitor into ~one per revalidate window — the same 30s
// freshness the storefront already accepts (app/s/[slug]/page.tsx). Invite buildings never reach
// this path: they stay fully dynamic for the cookie gate, so nothing behind an invite is ever
// cached. Tagged by building so a membership change can revalidateTag(`bazaar:<id>`) on demand.
function loadOpenBazaarContent(
  buildingId: string
): Promise<{ sellers: BazaarSeller[]; drops: BazaarDrop[] }> {
  return unstable_cache(
    () => readBazaarContent(buildingId),
    ["bazaar-content", buildingId],
    { revalidate: BAZAAR_CONTENT_REVALIDATE_SECONDS, tags: [`bazaar:${buildingId}`] }
  )();
}

export default async function BuildingBazaarPage({
  params
}: {
  params: Promise<{ publicSlug: string }>;
}) {
  const { publicSlug } = await params;
  if (!PUBLIC_SLUG_RE.test(publicSlug)) {
    notFound();
  }

  let buildingRow: BuildingPageRow | null;
  try {
    buildingRow = await loadGatedBuilding(publicSlug);
  } catch (error) {
    if (isTestSupabaseConfigError(error)) {
      notFound();
    }
    throw error;
  }
  if (!buildingRow) {
    notFound();
  }

  const building = buildingPublicSchema.parse({
    id: buildingRow.id,
    display_name: buildingRow.display_name,
    city: buildingRow.city,
    public_slug: buildingRow.public_slug,
    access_type: buildingRow.access_type,
    created_at: buildingRow.created_at
  });

  // Open buildings serve a short shared cache; invite buildings read fresh every request so the
  // cookie gate above can never be bypassed by a cached payload.
  const { sellers, drops } =
    building.access_type === "open"
      ? await loadOpenBazaarContent(building.id)
      : await readBazaarContent(building.id);

  if (sellers.length === 0) {
    // A building with no active members isn't a public surface yet.
    notFound();
  }

  return (
    <BazaarPage
      building={{
        name: building.display_name,
        city: building.city,
        slug: building.public_slug
      }}
      sellers={sellers}
      drops={drops}
    />
  );
}
