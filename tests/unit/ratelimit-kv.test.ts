import { describe, expect, it } from "vitest";

import {
  addToWindow,
  addToWindows,
  remainingInWindow,
  type KVNamespace
} from "@/lib/ratelimit/kv";

// Phase 6.5: the batch-aware fixed-window counter behind the per-store daily drop cap. A drop adds a
// whole recipient batch at once and must be rejected as a unit when it would breach the limit.

function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  const get = (key: string, type?: "json"): Promise<unknown> => {
    const v = store.get(key);
    if (v === undefined) return Promise.resolve(null);
    return Promise.resolve(type === "json" ? (JSON.parse(v) as unknown) : v);
  };
  const put = (key: string, value: string): Promise<void> => {
    store.set(key, value);
    return Promise.resolve();
  };
  return { get, put } as KVNamespace;
}

const WINDOW = 3600;
const LIMIT = 200;

describe("addToWindow", () => {
  it("adds a batch within the limit", async () => {
    const kv = fakeKv();
    const r = await addToWindow(kv, "k", 5, LIMIT, WINDOW);
    expect(r.allowed).toBe(true);
    expect(r.count).toBe(5);
  });

  it("rejects when current + amount exceeds the limit, without writing", async () => {
    const kv = fakeKv();
    await addToWindow(kv, "k", 5, LIMIT, WINDOW); // count = 5
    const blocked = await addToWindow(kv, "k", 196, LIMIT, WINDOW); // 5 + 196 = 201 > 200
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(5); // unchanged

    // The rejected batch left no residue: a fitting batch still goes through.
    const ok = await addToWindow(kv, "k", 195, LIMIT, WINDOW); // 5 + 195 = 200
    expect(ok.allowed).toBe(true);
    expect(ok.count).toBe(200);
  });

  it("rejects a fresh oversized batch without writing", async () => {
    const kv = fakeKv();
    const first = await addToWindow(kv, "k", LIMIT + 50, LIMIT, WINDOW);
    expect(first.allowed).toBe(false);
    expect(first.count).toBe(0);

    const second = await addToWindow(kv, "k", LIMIT, LIMIT, WINDOW);
    expect(second.allowed).toBe(true);
    expect(second.count).toBe(LIMIT);
  });
});

describe("remainingInWindow", () => {
  it("returns the full limit when KV is null (fail open)", async () => {
    expect(await remainingInWindow(null, "k", LIMIT)).toBe(LIMIT);
  });

  it("returns the full limit before anything is counted", async () => {
    expect(await remainingInWindow(fakeKv(), "k", LIMIT)).toBe(LIMIT);
  });

  it("reflects what's been spent", async () => {
    const kv = fakeKv();
    await addToWindow(kv, "k", 30, LIMIT, WINDOW);
    expect(await remainingInWindow(kv, "k", LIMIT)).toBe(170);
  });
});

describe("addToWindows", () => {
  it("reserves multiple windows together when they all fit", async () => {
    const kv = fakeKv();
    const result = await addToWindows(kv, [
      {
        key: "store",
        amount: 12,
        limit: LIMIT,
        windowSeconds: WINDOW
      },
      { key: "platform", amount: 12, limit: LIMIT, windowSeconds: WINDOW }
    ]);

    expect(result.allowed).toBe(true);
    expect(await remainingInWindow(kv, "store", LIMIT)).toBe(188);
    expect(await remainingInWindow(kv, "platform", LIMIT)).toBe(188);
  });

  it("does not write any window when one reservation blocks", async () => {
    const kv = fakeKv();
    await addToWindow(kv, "platform", LIMIT, LIMIT, WINDOW);

    const blocked = await addToWindows(kv, [
      {
        key: "store",
        amount: 1,
        limit: LIMIT,
        windowSeconds: WINDOW
      },
      { key: "platform", amount: 1, limit: LIMIT, windowSeconds: WINDOW }
    ]);

    expect(blocked.allowed).toBe(false);
    expect(await remainingInWindow(kv, "store", LIMIT)).toBe(LIMIT);
    expect(await remainingInWindow(kv, "platform", LIMIT)).toBe(0);
  });

  it("keeps every window strict on a fresh oversized batch", async () => {
    const kv = fakeKv();
    const blocked = await addToWindows(kv, [
      { key: "platform", amount: LIMIT + 1, limit: LIMIT, windowSeconds: WINDOW }
    ]);

    expect(blocked.allowed).toBe(false);
    expect(await remainingInWindow(kv, "platform", LIMIT)).toBe(LIMIT);
  });
});
