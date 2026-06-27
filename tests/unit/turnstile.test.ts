import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyTurnstile } from "@/lib/security/turnstile";

// Phase 9.3: server-side Turnstile verification. The soft challenge in front of the KV hard caps.

const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
  vi.unstubAllGlobals();
});

describe("verifyTurnstile", () => {
  it("allows when no secret is configured (dev / preview fail-open)", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await verifyTurnstile(undefined, "1.2.3.4")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("with a secret configured", () => {
    beforeEach(() => {
      process.env.TURNSTILE_SECRET_KEY = "test-secret";
    });

    it("blocks when the token is missing", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      expect(await verifyTurnstile(undefined, "1.2.3.4")).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("allows when siteverify returns success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))
      );
      expect(await verifyTurnstile("tok", "1.2.3.4")).toBe(true);
    });

    it("blocks when siteverify returns failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(new Response(JSON.stringify({ success: false }), { status: 200 }))
        )
      );
      expect(await verifyTurnstile("tok", "1.2.3.4")).toBe(false);
    });

    it("fails open on a network error (don't take down checkout)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new Error("network down")))
      );
      expect(await verifyTurnstile("tok", "1.2.3.4")).toBe(true);
    });
  });
});
