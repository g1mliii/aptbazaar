// Phase 9.3: Cloudflare Turnstile server-side verification for the anon order + subscribe flows.
// The widget hands the browser a one-time token; we exchange it at the siteverify endpoint with the
// secret. This is the soft challenge that sits in front of the KV hard limits.
//
// Fail behaviour:
//   - No secret configured (local `next dev`, unit tests, preview before keys are set) → allow.
//     Turnstile is a soft abuse control, not an auth gate; the KV limiter still applies.
//   - Secret set but no token → block (the widget should always supply one; absence means a
//     scripted client bypassing the form).
//   - siteverify network/parse error OR timeout → allow, but the caller-visible boolean stays true.
//     A third-party outage (or a slow-but-responsive siteverify) must not take down checkout; the KV
//     limiter and edge rules remain. The fetch is bounded so a hung siteverify can't stall the whole
//     order/subscribe hot path waiting on the default fetch timeout.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 3000;

export async function verifyTurnstile(
  token: string | undefined,
  ip: string
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);

    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS)
    });
    if (!response.ok) return true;

    const data: { success?: boolean } = await response.json();
    return data.success === true;
  } catch {
    // Network error, parse error, or the abort timeout firing — fail open.
    return true;
  }
}
