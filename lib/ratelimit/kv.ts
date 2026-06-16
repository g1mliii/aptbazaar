import { getCloudflareContext } from "@opennextjs/cloudflare";

// Phase 2.7: fixed-window counters in Cloudflare KV, used by the magic-link rate limiter.
// KV has no atomic increment; we store { count, expiresAt } and recompute the TTL on each
// write so a busy key never extends its own window. Good enough for a soft abuse limit.

// Minimal shape of a Workers KV namespace (avoids a hard dep on @cloudflare/workers-types).
export interface KVNamespace {
  get(key: string, type: "json"): Promise<unknown>;
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
}

const KV_MIN_TTL_SECONDS = 60;

interface Window {
  count: number;
  expiresAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

/**
 * Returns the bound rate-limit KV namespace, or null when it isn't available (e.g.
 * `next dev` outside the Worker runtime). Callers fail open on null — the limiter is a
 * soft abuse control, not an auth gate.
 */
export function getRateLimitKv(): KVNamespace | null {
  try {
    const { env } = getCloudflareContext();
    return (env as { RATE_LIMIT_KV?: KVNamespace }).RATE_LIMIT_KV ?? null;
  } catch {
    return null;
  }
}

export async function incrementWithTtl(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const existing = (await kv.get(key, "json")) as Window | null;

  if (existing && existing.expiresAt > now) {
    const remainingTtl = Math.max(KV_MIN_TTL_SECONDS, Math.ceil((existing.expiresAt - now) / 1000));
    const retryAfterSeconds = Math.ceil((existing.expiresAt - now) / 1000);

    if (existing.count >= limit) {
      return { allowed: false, count: existing.count, retryAfterSeconds };
    }

    const count = existing.count + 1;
    await kv.put(key, JSON.stringify({ count, expiresAt: existing.expiresAt }), {
      expirationTtl: remainingTtl
    });
    return { allowed: true, count, retryAfterSeconds };
  }

  const expiresAt = now + windowSeconds * 1000;
  await kv.put(key, JSON.stringify({ count: 1, expiresAt }), {
    expirationTtl: Math.max(KV_MIN_TTL_SECONDS, windowSeconds)
  });
  return { allowed: true, count: 1, retryAfterSeconds: windowSeconds };
}
