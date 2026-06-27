import type { KVNamespace } from "@/lib/ratelimit/kv";

// Shared Map-backed KVNamespace stub for the rate-limit unit tests. Implements just the get/put
// surface the limiter touches (the same contract incrementWithTtl/addToWindow/addToWindows use), so
// a single definition covers anon-windows, ratelimit-kv, and subscriber-actions. Not a test itself —
// the vitest `unit` project only picks up *.test/*.spec files.

export function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  const get = (key: string, type?: "json"): Promise<unknown> => {
    const value = store.get(key);
    if (value === undefined) return Promise.resolve(null);
    return Promise.resolve(type === "json" ? (JSON.parse(value) as unknown) : value);
  };
  const put = (key: string, value: string): Promise<void> => {
    store.set(key, value);
    return Promise.resolve();
  };
  return { get, put } as KVNamespace;
}
