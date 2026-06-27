import { describe, expect, it } from "vitest";

import { addToWindows } from "@/lib/ratelimit/kv";
import {
  ANON_WINDOW_SECONDS,
  ORDER_IP_STORE_LIMIT,
  ORDER_STORE_LIMIT,
  SUBSCRIBE_IP_STORE_LIMIT,
  SUBSCRIBE_STORE_LIMIT,
  orderIpStoreKey,
  orderStoreKey,
  subscribeIpStoreKey
} from "@/lib/ratelimit/anon-windows";

import { fakeKv } from "./fake-kv";

// Phase 9.3: per-minute window keys for the anon order/subscribe flows. The minute bucket lives in
// the key, so the window mechanics (addToWindows) are unchanged — these tests pin the bucketing and
// the documented thresholds.

const MINUTE = 60 * 1000;

describe("anon window keys", () => {
  it("documents the plan's thresholds", () => {
    expect(ORDER_IP_STORE_LIMIT).toBe(10);
    expect(ORDER_STORE_LIMIT).toBe(30);
    expect(SUBSCRIBE_IP_STORE_LIMIT).toBe(5);
    expect(SUBSCRIBE_STORE_LIMIT).toBe(60);
    expect(ANON_WINDOW_SECONDS).toBe(60);
  });

  it("buckets to the wall-clock minute", () => {
    const t = 100 * MINUTE + 1234;
    expect(orderStoreKey("s1", t)).toBe(orderStoreKey("s1", t + 5000));
    expect(orderStoreKey("s1", t)).not.toBe(orderStoreKey("s1", t + MINUTE));
  });

  it("separates ip+store from store-wide and order from subscribe", () => {
    const t = 5 * MINUTE;
    expect(orderIpStoreKey("1.2.3.4", "s1", t)).not.toBe(orderStoreKey("s1", t));
    expect(orderIpStoreKey("1.2.3.4", "s1", t)).not.toBe(
      subscribeIpStoreKey("1.2.3.4", "s1", t)
    );
  });
});

describe("order rate-limit reservation", () => {
  it("allows up to the per-(ip,store) limit then blocks within the same minute", async () => {
    const kv = fakeKv();
    const now = 7 * MINUTE;
    const reserve = () =>
      addToWindows(kv, [
        {
          key: orderIpStoreKey("9.9.9.9", "store-a", now),
          amount: 1,
          limit: ORDER_IP_STORE_LIMIT,
          windowSeconds: ANON_WINDOW_SECONDS
        },
        {
          key: orderStoreKey("store-a", now),
          amount: 1,
          limit: ORDER_STORE_LIMIT,
          windowSeconds: ANON_WINDOW_SECONDS
        }
      ]);

    for (let i = 0; i < ORDER_IP_STORE_LIMIT; i++) {
      expect((await reserve()).allowed).toBe(true);
    }
    expect((await reserve()).allowed).toBe(false);

    // A new minute resets the bucket.
    const next = now + MINUTE;
    const fresh = await addToWindows(kv, [
      {
        key: orderIpStoreKey("9.9.9.9", "store-a", next),
        amount: 1,
        limit: ORDER_IP_STORE_LIMIT,
        windowSeconds: ANON_WINDOW_SECONDS
      }
    ]);
    expect(fresh.allowed).toBe(true);
  });
});
