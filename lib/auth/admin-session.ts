import { requiredEnv } from "@/lib/env";
import {
  readCookiePayload,
  signCookiePayload,
  timingSafeEqualStrings
} from "@/lib/utils/signed-cookie";

// Phase 10.6: the founder dashboard at /admin is gated by a single shared secret. Knowing
// ADMIN_SHARED_SECRET at the login gate mints a short-lived signed cookie; the middleware then
// verifies that cookie on every /admin request. The HMAC envelope (signed-cookie) is the same one
// the signup + bazaar-invite cookies use, so this runs in the edge middleware too — do NOT add
// `server-only` here. This module owns only the admin payload shape, TTL, and the secret compare.

export const ADMIN_COOKIE_NAME = "admin_session";
// 12 hours: long enough for a founder working session, short enough that a leaked cookie expires.
export const ADMIN_COOKIE_TTL_SECONDS = 12 * 60 * 60;

interface AdminSessionPayload {
  issuedAt: number;
}

/** Returns the signed cookie value proving the holder cleared the /admin login gate. */
export async function signAdminSession(issuedAt: number): Promise<string> {
  return signCookiePayload({ issuedAt } satisfies AdminSessionPayload);
}

/** True only when the cookie was signed by us and is still within its TTL. */
export async function verifyAdminSession(
  raw: string | undefined,
  now: number
): Promise<boolean> {
  const parsed = (await readCookiePayload(raw)) as Partial<AdminSessionPayload> | null;
  if (!parsed || typeof parsed.issuedAt !== "number") {
    return false;
  }
  return now - parsed.issuedAt <= ADMIN_COOKIE_TTL_SECONDS * 1000;
}

/** Constant-time compare of a submitted secret against ADMIN_SHARED_SECRET. Server-only at runtime. */
export function adminSecretMatches(submitted: string): boolean {
  if (!submitted) {
    return false;
  }
  return timingSafeEqualStrings(submitted, requiredEnv("ADMIN_SHARED_SECRET"));
}
