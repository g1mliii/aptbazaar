import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KVNamespace, RateLimitReservation } from "@/lib/ratelimit/kv";
import type * as RateLimitKvModule from "@/lib/ratelimit/kv";

import { fakeKv } from "./fake-kv";

const mocks = vi.hoisted(() => ({
  clientIp: vi.fn<() => Promise<string>>(),
  kv: null as KVNamespace | null,
  verifyTurnstile: vi.fn<() => Promise<boolean>>()
}));

vi.mock("@/lib/security/request-ip", () => ({
  clientIp: mocks.clientIp
}));

vi.mock("@/lib/security/turnstile", () => ({
  verifyTurnstile: mocks.verifyTurnstile
}));

vi.mock("@/lib/ratelimit/kv", async (importOriginal) => {
  const actual = await importOriginal<typeof RateLimitKvModule>();
  return {
    ...actual,
    getRateLimitKv: () => mocks.kv
  };
});

const { guardAnonWrite } = await import("@/lib/ratelimit/anon-guard");

function oneShotWindow(ip: string): RateLimitReservation[] {
  return [
    {
      key: `order:${ip}:store-a`,
      amount: 1,
      limit: 1,
      windowSeconds: 60
    }
  ];
}

describe("guardAnonWrite", () => {
  beforeEach(() => {
    mocks.clientIp.mockResolvedValue("1.2.3.4");
    mocks.kv = fakeKv();
    mocks.verifyTurnstile.mockResolvedValue(true);
  });

  it("sheds over-limit traffic before calling Turnstile siteverify", async () => {
    expect(await guardAnonWrite("tok", oneShotWindow)).toEqual({ ok: true });
    expect(mocks.verifyTurnstile).toHaveBeenCalledTimes(1);

    mocks.verifyTurnstile.mockClear();
    await expect(guardAnonWrite("tok", oneShotWindow)).resolves.toEqual({
      ok: false,
      reason: "rate_limit"
    });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
  });

  it("still reports a Turnstile failure when the request is under the hard cap", async () => {
    mocks.verifyTurnstile.mockResolvedValue(false);

    await expect(guardAnonWrite("bad-token", oneShotWindow)).resolves.toEqual({
      ok: false,
      reason: "turnstile"
    });
  });
});
