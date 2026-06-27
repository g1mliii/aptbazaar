import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as RateLimitKvModule from "@/lib/ratelimit/kv";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  getRateLimitKv: vi.fn(),
  loadActiveRecipients: vi.fn(),
  requireSeller: vi.fn(),
  sendDropEmail: vi.fn(),
  writeAuditLog: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({
  requireSeller: mocks.requireSeller
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer
}));

vi.mock("@/lib/subscribers/recipients", () => ({
  loadActiveRecipients: mocks.loadActiveRecipients,
  SUBSCRIBER_LIST_LIMIT: 1000
}));

vi.mock("@/lib/email/drop", () => ({
  sendDropEmail: mocks.sendDropEmail
}));

vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: mocks.writeAuditLog
}));

vi.mock("@/lib/env", () => ({
  appBaseUrl: () => "https://stoop.test"
}));

vi.mock("@/lib/ratelimit/kv", async (importOriginal) => {
  const actual = await importOriginal<typeof RateLimitKvModule>();
  return {
    ...actual,
    getRateLimitKv: mocks.getRateLimitKv
  };
});

import { exportSubscribersCsv, sendDrop } from "@/lib/actions/subscribers";
import { addToWindow, remainingInWindow } from "@/lib/ratelimit/kv";
import {
  DROP_DAILY_LIMIT,
  DROP_PLATFORM_DAILY_LIMIT,
  dropPlatformWindowKey,
  dropWindowKey,
  secondsUntilUtcMidnight
} from "@/lib/subscribers/drop-window";

import { fakeKv } from "./fake-kv";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const SELLER_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function storeQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: STORE_ID, name: "Priya's Kitchen", slug: "priyas-kitchen" },
      error: null
    })
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.requireSeller.mockResolvedValue({
    id: SELLER_ID,
    user_id: USER_ID,
    display_name: "Priya M.",
    contact_address: "123 Main St, Toronto"
  });
  mocks.createServer.mockResolvedValue({ from: vi.fn(() => storeQuery()) });
  mocks.loadActiveRecipients.mockResolvedValue([
    { email: "one@example.test", unsubscribe_token: "tok-one" },
    { email: "two@example.test", unsubscribe_token: "tok-two" }
  ]);
  mocks.getRateLimitKv.mockReturnValue(null);
  mocks.sendDropEmail.mockResolvedValue(undefined);
  mocks.writeAuditLog.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("sendDrop", () => {
  it("blocks oversized active lists before reserving or sending", async () => {
    mocks.loadActiveRecipients.mockResolvedValue(
      Array.from({ length: DROP_DAILY_LIMIT + 1 }, (_, i) => ({
        email: `fan-${i}@example.test`,
        unsubscribe_token: `tok-${i}`
      }))
    );

    await expect(
      sendDrop({ subject: "Saturday bake list", body: "Sourdough is ready." })
    ).resolves.toEqual({
      ok: false,
      error: `Today's limit is ${DROP_DAILY_LIMIT} drop emails. Your active list is bigger than that.`
    });

    expect(mocks.sendDropEmail).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.loadActiveRecipients).toHaveBeenCalledWith(
      expect.anything(),
      STORE_ID,
      DROP_DAILY_LIMIT + 1
    );
  });

  it("blocks before sending when the platform-wide daily window is full", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00.000Z"));
    const kv = fakeKv();
    const now = Date.now();
    await addToWindow(
      kv,
      dropPlatformWindowKey(now),
      DROP_PLATFORM_DAILY_LIMIT,
      DROP_PLATFORM_DAILY_LIMIT,
      secondsUntilUtcMidnight(now)
    );
    mocks.getRateLimitKv.mockReturnValue(kv);

    await expect(
      sendDrop({ subject: "Saturday bake list", body: "Sourdough is ready." })
    ).resolves.toEqual({
      ok: false,
      error: "Stoop's drop email limit is full for today. Try again tomorrow."
    });

    expect(mocks.sendDropEmail).not.toHaveBeenCalled();
    expect(
      await remainingInWindow(kv, dropWindowKey(STORE_ID, now), DROP_DAILY_LIMIT)
    ).toBe(DROP_DAILY_LIMIT);
  });

  it("returns a failure when every email send fails", async () => {
    mocks.sendDropEmail.mockRejectedValue(new Error("email unavailable"));

    await expect(
      sendDrop({ subject: "Saturday bake list", body: "Sourdough is ready." })
    ).resolves.toEqual({
      ok: false,
      error: "We couldn't send that drop. Try again in a moment."
    });

    expect(mocks.sendDropEmail).toHaveBeenCalledTimes(2);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

function queryWithStoreAndSubscribers(pages: unknown[][]) {
  let page = 0;
  const from = vi.fn((table: string) => {
    if (table === "stores") {
      return storeQuery();
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockImplementation(() =>
        Promise.resolve({ data: pages[page++] ?? [], error: null })
      )
    };
  });
  return { from };
}

describe("exportSubscribersCsv", () => {
  it("pages through the full roster instead of exporting only the rendered slice", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      email: `fan-${i}@example.test`,
      verified_at: "2026-06-01T00:00:00.000Z",
      unsubscribed_at: null,
      created_at: "2026-06-01T00:00:00.000Z"
    }));
    const secondPage = [
      {
        email: "fan-1000@example.test",
        verified_at: null,
        unsubscribed_at: "2026-06-02T00:00:00.000Z",
        created_at: "2026-06-02T00:00:00.000Z"
      }
    ];
    const client = queryWithStoreAndSubscribers([firstPage, secondPage]);
    mocks.createServer.mockResolvedValue(client);

    const result = await exportSubscribersCsv();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filename).toBe("subscribers-priyas-kitchen.csv");
      expect(result.csv).toContain("fan-0@example.test");
      expect(result.csv).toContain("fan-1000@example.test");
      expect(result.csv).toContain("unsubscribed");
      expect(result.csv.split("\r\n")).toHaveLength(1002);
    }
  });
});
