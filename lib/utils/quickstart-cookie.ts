import "server-only";

import {
  pendingSignupSchema,
  type PendingSignup
} from "@/lib/schemas/signup";
import { readCookiePayload, signCookiePayload } from "@/lib/utils/signed-cookie";

// Phase 3.1/3.2: between requesting a signup magic link and the callback that creates the
// tenant, the quick-start payload lives in a short-lived signed cookie — NOT the database, so
// an abandoned signup never leaves orphan rows. The HMAC envelope (signed with SIGNUP_COOKIE_SECRET)
// lives in lib/utils/signed-cookie; this module owns the signup payload's schema + TTL.

export const SIGNUP_COOKIE_NAME = "stoop_pending_signup";
export const SIGNUP_COOKIE_TTL_SECONDS = 30 * 60;

/** Returns the signed cookie value `<payload>.<sig>` for a quick-start payload. */
export async function signPendingSignup(payload: PendingSignup): Promise<string> {
  return signCookiePayload(payload);
}

/**
 * Verifies signature + TTL + shape. Returns the payload, or null on any failure (tampered,
 * expired, malformed) — callers treat null as "no valid pending signup".
 */
export async function verifyPendingSignup(
  raw: string | undefined
): Promise<PendingSignup | null> {
  const payload = await readCookiePayload(raw);
  if (payload === null) {
    return null;
  }
  const parsed = pendingSignupSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  if (Date.now() - parsed.data.issuedAt > SIGNUP_COOKIE_TTL_SECONDS * 1000) {
    return null;
  }
  return parsed.data;
}
