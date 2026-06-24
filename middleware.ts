import { NextResponse, type NextRequest } from "next/server";

import { requiredEnv } from "@/lib/env";
import {
  bazaarCookieName,
  BAZAAR_COOKIE_TTL_SECONDS,
  signBazaarInvite,
  timingSafeEqualStrings
} from "@/lib/utils/bazaar-invite-cookie";
import { PUBLIC_SLUG_RE } from "@/lib/utils/slug";

// Phase 8.5: invite-code entry for building bazaars. Next 16's proxy.ts is the canonical
// convention, but it runs as Node Middleware; @opennextjs/cloudflare currently supports Edge
// Middleware and rejects Node Middleware during packaging. Keep this Edge-compatible file until the
// Cloudflare adapter supports proxy.ts.

export const config = {
  matcher: "/b/:slug*"
};

type InviteBuildingRow = {
  access_type: "open" | "invite";
  invite_code: string | null;
  invite_code_rotated_at: string | null;
};

async function loadInviteBuilding(slug: string): Promise<InviteBuildingRow | null> {
  const restUrl = new URL(
    "/rest/v1/buildings",
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL")
  );
  restUrl.searchParams.set("select", "access_type,invite_code,invite_code_rotated_at");
  restUrl.searchParams.set("public_slug", `eq.${slug}`);
  restUrl.searchParams.set("limit", "1");

  const serviceKey = requiredEnv("SUPABASE_SECRET_KEY");
  const response = await fetch(restUrl, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    },
    cache: "no-store"
  });
  if (!response.ok) {
    return null;
  }

  const rows: InviteBuildingRow[] = await response.json();
  return rows[0] ?? null;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.next();
  }

  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  const slug = segments[1];
  const cleanUrl = request.nextUrl.clone();
  cleanUrl.search = "";

  // Whatever happens, strip the code from the URL. Only a correct code for an invite building also
  // mints the cookie; an open building or a wrong code just lands on the clean URL (the page decides
  // whether to render or 404 — identical response for missing vs wrong, no enumeration).
  const redirect = NextResponse.redirect(cleanUrl, 307);

  if (!slug || !PUBLIC_SLUG_RE.test(slug)) {
    return redirect;
  }

  try {
    const building = await loadInviteBuilding(slug);

    if (
      building?.access_type === "invite" &&
      building.invite_code &&
      building.invite_code_rotated_at &&
      timingSafeEqualStrings(code, building.invite_code)
    ) {
      const value = await signBazaarInvite(
        slug,
        building.invite_code_rotated_at,
        Date.now()
      );
      redirect.cookies.set(bazaarCookieName(slug), value, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: `/b/${slug}`,
        maxAge: BAZAAR_COOKIE_TTL_SECONDS
      });
    }
  } catch {
    // Fall through to the clean redirect; the page handles the un-gated state.
  }

  return redirect;
}
