import { headers } from "next/headers";

// Phase 9.3: the client IP used to scope anon rate limits per (ip, store). On Cloudflare the
// trustworthy source is `cf-connecting-ip` (set by the edge, not spoofable by the client);
// `x-forwarded-for` is the fallback for other runtimes and local dev. Returns "unknown" when no
// header is present so callers still get a stable bucket key (all unknowns share one window).

export async function clientIp(): Promise<string> {
  try {
    const h = await headers();
    const cf = h.get("cf-connecting-ip");
    if (cf) return cf.trim();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim();
  } catch {
    // No request scope (unit tests / non-request context) — fall through to the shared bucket.
  }
  return "unknown";
}
