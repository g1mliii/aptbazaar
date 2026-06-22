import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createSecret: vi.fn(),
  writeAuditLog: vi.fn()
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: mocks.createSecret
}));

vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: mocks.writeAuditLog
}));

import { unsubscribeByToken } from "@/lib/subscribers/unsubscribe";

const TOKEN = "abcdefghijklmnopqrstuv";
const SUBSCRIBER_ID = "11111111-1111-4111-8111-111111111111";

function loadQuery(unsubscribedAt: string | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: SUBSCRIBER_ID,
        store_id: "22222222-2222-4222-8222-222222222222",
        unsubscribed_at: unsubscribedAt,
        stores: { name: "Priya's Kitchen", slug: "priyas-kitchen" }
      },
      error: null
    })
  };
}

function failingLoadQuery() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: null,
      error: { message: "database unavailable" }
    })
  };
}

function guardedUpdateQuery(updated: { id: string } | null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: updated, error: null })
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeAuditLog.mockResolvedValue(undefined);
});

describe("unsubscribeByToken", () => {
  it("audit-logs when the guarded update flips the subscriber", async () => {
    const update = guardedUpdateQuery({ id: SUBSCRIBER_ID });
    mocks.createSecret
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(loadQuery(null)) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(update) });

    await expect(unsubscribeByToken(TOKEN)).resolves.toEqual({
      ok: true,
      storeName: "Priya's Kitchen",
      storeSlug: "priyas-kitchen"
    });

    expect(update.update).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- asymmetric matcher
      unsubscribed_at: expect.any(String)
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      actorType: "anon",
      action: "subscriber.unsubscribed",
      targetTable: "subscribers",
      targetId: SUBSCRIBER_ID
    });
  });

  it("does not audit when a concurrent request already flipped the row", async () => {
    mocks.createSecret
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(loadQuery(null)) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(guardedUpdateQuery(null)) });

    await expect(unsubscribeByToken(TOKEN)).resolves.toEqual({
      ok: true,
      storeName: "Priya's Kitchen",
      storeSlug: "priyas-kitchen"
    });

    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("reports lookup failures as write failures so one-click clients retry", async () => {
    mocks.createSecret.mockReturnValueOnce({
      from: vi.fn().mockReturnValue(failingLoadQuery())
    });

    await expect(unsubscribeByToken(TOKEN)).resolves.toEqual({
      ok: false,
      reason: "write_failed"
    });

    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
