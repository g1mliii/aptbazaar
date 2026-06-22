import { getCloudflareContext } from "@opennextjs/cloudflare";

// Phase 2.7: fixed-window counters in Cloudflare KV, used by the magic-link rate limiter.
// KV has no atomic increment; we store { count, expiresAt } and recompute the TTL on each
// write so a busy key never extends its own window. Good enough for a soft abuse limit.

// Minimal shape of a Workers KV namespace (avoids a hard dep on @cloudflare/workers-types).
export interface KVNamespace {
  get(key: string, type: "json"): Promise<unknown>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
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

export interface RateLimitReservation {
  key: string;
  amount: number;
  limit: number;
  windowSeconds: number;
}

export type RateLimitBatchResult =
  | { allowed: true; counts: Record<string, number> }
  | {
      allowed: false;
      key: string;
      count: number;
      retryAfterSeconds: number;
    };

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
    const remainingTtl = Math.max(
      KV_MIN_TTL_SECONDS,
      Math.ceil((existing.expiresAt - now) / 1000)
    );
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

/** Load the stored window only while it's still active; null when absent, expired, or KV-empty. */
async function readActiveWindow(
  kv: KVNamespace,
  key: string,
  now: number
): Promise<Window | null> {
  const existing = (await kv.get(key, "json")) as Window | null;
  return existing && existing.expiresAt > now ? existing : null;
}

/**
 * Read-only peek at how much of a fixed-window limit is left (Phase 6.5 drop KPI). Returns the full
 * limit when the window is absent/expired or KV isn't bound — the same fail-open contract as the
 * limiter. Never writes, so calling it from a render path is safe.
 */
export async function remainingInWindow(
  kv: KVNamespace | null,
  key: string,
  limit: number
): Promise<number> {
  if (!kv) return limit;
  const active = await readActiveWindow(kv, key, Date.now());
  return active ? Math.max(0, limit - active.count) : limit;
}

/**
 * Batch variant of the fixed-window counter (Phase 6.5 drop send). incrementWithTtl only steps by
 * 1; a drop adds a whole recipient batch at once. A drop is all-or-nothing, so the batch is only
 * rejected when it would push the window over the cap. The existing window's expiry is kept so a
 * busy key never extends its own window. Same soft-limit contract as incrementWithTtl — callers
 * fail open when KV is null.
 */
export async function addToWindow(
  kv: KVNamespace,
  key: string,
  amount: number,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const active = await readActiveWindow(kv, key, now);

  const currentCount = active?.count ?? 0;
  const expiresAt = active?.expiresAt ?? now + windowSeconds * 1000;
  const retryAfterSeconds = Math.ceil((expiresAt - now) / 1000);

  if (currentCount + amount > limit) {
    return { allowed: false, count: currentCount, retryAfterSeconds };
  }

  const count = currentCount + amount;
  await kv.put(key, JSON.stringify({ count, expiresAt }), {
    expirationTtl: Math.max(KV_MIN_TTL_SECONDS, retryAfterSeconds)
  });
  return { allowed: true, count, retryAfterSeconds };
}

/**
 * Reserve multiple soft-limit windows as one decision. KV is not transactional, but this prevents
 * the common false-consumption case where one counter is written before a second counter blocks.
 */
export async function addToWindows(
  kv: KVNamespace,
  reservations: RateLimitReservation[]
): Promise<RateLimitBatchResult> {
  const now = Date.now();
  const prepared = await Promise.all(
    reservations.map(async (reservation) => {
      const active = await readActiveWindow(kv, reservation.key, now);
      const currentCount = active?.count ?? 0;
      const expiresAt = active?.expiresAt ?? now + reservation.windowSeconds * 1000;
      const retryAfterSeconds = Math.ceil((expiresAt - now) / 1000);
      const count = currentCount + reservation.amount;
      const allowed = count <= reservation.limit;

      return {
        ...reservation,
        allowed,
        count,
        currentCount,
        expiresAt,
        retryAfterSeconds
      };
    })
  );

  const blocked = prepared.find((reservation) => !reservation.allowed);
  if (blocked) {
    return {
      allowed: false,
      key: blocked.key,
      count: blocked.currentCount,
      retryAfterSeconds: blocked.retryAfterSeconds
    };
  }

  await Promise.all(
    prepared.map((reservation) =>
      kv.put(
        reservation.key,
        JSON.stringify({ count: reservation.count, expiresAt: reservation.expiresAt }),
        {
          expirationTtl: Math.max(KV_MIN_TTL_SECONDS, reservation.retryAfterSeconds)
        }
      )
    )
  );

  return {
    allowed: true,
    counts: Object.fromEntries(
      prepared.map((reservation) => [reservation.key, reservation.count])
    )
  };
}
