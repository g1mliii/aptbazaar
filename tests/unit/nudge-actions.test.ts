import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createServer: vi.fn(),
  getUser: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer
}));

const { markFirstScanSeen } = await import("@/lib/actions/nudge");

const STORE_ID = "11111111-1111-4111-8111-111111111111";

function storeUpdateQuery() {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: null, error: null })
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("markFirstScanSeen", () => {
  it("marks only the displayed store after a first scan exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00.000Z"));
    const query = storeUpdateQuery();
    const from = vi.fn(() => query);
    mocks.createServer.mockResolvedValue({ auth: { getUser: mocks.getUser }, from });

    await markFirstScanSeen(STORE_ID);

    expect(from).toHaveBeenCalledWith("stores");
    expect(query.update).toHaveBeenCalledWith({
      first_scan_seen_at: "2026-06-22T12:00:00.000Z"
    });
    expect(query.eq).toHaveBeenCalledWith("id", STORE_ID);
    expect(query.not).toHaveBeenCalledWith("first_scan_at", "is", null);
    expect(query.is).toHaveBeenCalledWith("first_scan_seen_at", null);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/orders");
  });

  it("ignores malformed store ids before opening a server client", async () => {
    await markFirstScanSeen("not-a-store");

    expect(mocks.createServer).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
