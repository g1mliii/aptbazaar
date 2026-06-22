// Phase 6.5: the per-store daily drop cap window. Shared so the send action (which reserves against
// it) and the Subscribers KPI (which peeks at what's left) build the exact same KV key and limit.

export const DROP_DAILY_LIMIT = 200;
const DEFAULT_DROP_PLATFORM_DAILY_LIMIT = DROP_DAILY_LIMIT * 25;

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const DROP_PLATFORM_DAILY_LIMIT = positiveIntFromEnv(
  "DROP_PLATFORM_DAILY_LIMIT",
  DEFAULT_DROP_PLATFORM_DAILY_LIMIT
);

function utcDayKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

/** KV key for a store's drop count on the current UTC day. */
export function dropWindowKey(storeId: string, now: number): string {
  return `drop:store:${storeId}:${utcDayKey(now)}`;
}

/** KV key for platform-wide drop email volume on the current UTC day. */
export function dropPlatformWindowKey(now: number): string {
  return `drop:platform:${utcDayKey(now)}`;
}

/** Seconds remaining until the next UTC midnight — when the window resets. */
export function secondsUntilUtcMidnight(now: number): number {
  const d = new Date(now);
  const nextMidnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1
  );
  return Math.max(60, Math.ceil((nextMidnight - now) / 1000));
}
