import {
  readCookiePayload,
  signCookiePayload,
  timingSafeEqualStrings
} from "@/lib/utils/signed-cookie";

// Phase 8.5: a signed cookie proving the visitor entered an invite-only building's shared code. We
// never store the code itself — only an HMAC over the building slug + the code's rotation timestamp,
// so rotating the code (which bumps invite_code_rotated_at) instantly invalidates every old cookie.
// The HMAC envelope lives in lib/utils/signed-cookie (shared with the quick-start signup cookie); this
// module owns only the bazaar-specific payload shape and gate rules.

// Re-exported for proxy.ts, which constant-time-compares a submitted invite code against the stored one.
export { timingSafeEqualStrings };

export const BAZAAR_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Per-building cookie name. The slug is the public_slug (already `[a-z0-9-]`). */
export function bazaarCookieName(slug: string): string {
  return `bazaar_${slug}`;
}

interface BazaarInvitePayload {
  // The building public_slug the cookie is scoped to (defends against cross-building cookie reuse).
  slug: string;
  // The building's invite_code_rotated_at at issue time. Mismatch ⇒ the code has since rotated.
  rotatedAt: string;
  issuedAt: number;
}

/** Returns the signed cookie value `<payload>.<sig>` binding the visitor to the current code. */
export async function signBazaarInvite(
  slug: string,
  rotatedAt: string,
  issuedAt: number
): Promise<string> {
  const payload: BazaarInvitePayload = { slug, rotatedAt, issuedAt };
  return signCookiePayload(payload);
}

/**
 * Verifies signature + TTL + slug scope + rotation claim. Returns true only when the cookie was
 * signed by us, hasn't expired, is scoped to this slug, and its rotatedAt matches the building's
 * current invite_code_rotated_at. Any failure (tampered, expired, rotated, wrong building) ⇒ false.
 */
export async function verifyBazaarInvite(
  raw: string | undefined,
  slug: string,
  dbRotatedAt: string | null,
  now: number
): Promise<boolean> {
  if (!dbRotatedAt) {
    return false;
  }
  const parsed = (await readCookiePayload(raw)) as Partial<BazaarInvitePayload> | null;
  if (
    !parsed ||
    typeof parsed.slug !== "string" ||
    typeof parsed.rotatedAt !== "string" ||
    typeof parsed.issuedAt !== "number"
  ) {
    return false;
  }
  if (parsed.slug !== slug) {
    return false;
  }
  if (now - parsed.issuedAt > BAZAAR_COOKIE_TTL_SECONDS * 1000) {
    return false;
  }
  return parsed.rotatedAt === dbRotatedAt;
}
