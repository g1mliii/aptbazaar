import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "@/app/api/health/route";

import { getHealthPayload } from "@/lib/health/checks";

describe("health checks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns safe status fields without requiring secrets", async () => {
    const payload = await getHealthPayload(false);

    expect(payload.status).toBe("ok");
    expect(payload.version.app).toBeTruthy();
    expect(payload.checks.supabase).toMatchObject({
      configured: false,
      ok: null
    });
    expect(payload.checks.email).toMatchObject({
      configured: false,
      ok: null
    });
  });

  it("adds abort signals to deep upstream checks", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    );
    vi.stubGlobal("fetch", fetch);

    await getHealthPayload(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    const supabaseRequest = fetch.mock.calls[0];
    const requestInit = supabaseRequest?.[1];

    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps degraded health payloads to a service-unavailable response", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(new Response(null, { status: 503 }))
      )
    );

    const response = await GET(
      new NextRequest("https://stoop.example/api/health?deep=1")
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded"
    });
  });

  it("keeps deep health checks private in production", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);

    const response = await GET(
      new NextRequest("https://stoop.example/api/health?deep=1")
    );

    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
