import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createSecret: vi.fn(),
  rpc: vi.fn()
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: mocks.createSecret
}));

const { GET } = await import("@/app/api/scan/route");

const STORE_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.createSecret.mockReturnValue({ rpc: mocks.rpc });
});

describe("/api/scan", () => {
  it("records a scan without a visitor-derived or global KV throttle key", async () => {
    await GET(
      new Request(`https://stoop.test/api/scan?store=${STORE_ID}&src=instagram`, {
        headers: { "cf-connecting-ip": "203.0.113.4" }
      })
    );

    expect(mocks.rpc).toHaveBeenCalledWith("record_scan", {
      p_store_id: STORE_ID,
      p_src: "instagram"
    });
  });
});
