import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  anonFrom: vi.fn(),
  anonInsert: vi.fn(),
  createAnon: vi.fn(),
  createSecret: vi.fn(),
  generateToken: vi.fn(),
  orderRpc: vi.fn(),
  storeEq: vi.fn(),
  storeMaybeSingle: vi.fn(),
  storeSelect: vi.fn()
}));

vi.mock("@/lib/supabase/anon", () => ({
  createSupabaseAnonClient: mocks.createAnon
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: mocks.createSecret
}));

vi.mock("@/lib/utils/token", () => ({
  generateToken: mocks.generateToken
}));

vi.mock("@/lib/email/order-confirmation", () => ({
  sendOrderConfirmationEmails: vi.fn()
}));

vi.mock("@/lib/orders/request-hash", () => ({
  orderRequestHash: vi.fn(() => Promise.resolve("request-hash"))
}));

import { placeOrder } from "@/lib/actions/orders";
import { subscribe } from "@/lib/actions/subscribers";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function orderInput(overrides: Record<string, unknown> = {}) {
  return {
    storeId: UUID_A,
    customerName: "Sam",
    customerEmail: "sam@example.test",
    paymentMode: "pay_at_pickup",
    idempotencyKey: UUID_B,
    items: [{ productId: UUID_B, quantity: 1 }],
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.generateToken.mockReturnValue("token");
  mocks.anonFrom.mockReturnValue({ insert: mocks.anonInsert });
  mocks.anonInsert.mockResolvedValue({ error: null });
  mocks.createAnon.mockReturnValue({ from: mocks.anonFrom });

  mocks.storeSelect.mockReturnValue({ eq: mocks.storeEq });
  mocks.storeEq.mockReturnValue({ maybeSingle: mocks.storeMaybeSingle });
  mocks.storeMaybeSingle.mockResolvedValue({
    data: { is_active: true, accept_pay_at_pickup: true },
    error: null
  });
  mocks.orderRpc.mockResolvedValue({
    data: [{ order_id: UUID_A, token: "tracking-token", replayed: false }],
    error: null
  });
  mocks.createSecret.mockReturnValue({
    from: vi.fn(() => ({ select: mocks.storeSelect })),
    rpc: mocks.orderRpc
  });
});

describe("subscribe", () => {
  it("uses the no-cookie anon client for storefront subscriber inserts", async () => {
    await expect(
      subscribe({ storeId: UUID_A, email: "fan@example.test", consentEmail: true })
    ).resolves.toEqual({ ok: true });

    expect(mocks.createAnon).toHaveBeenCalledTimes(1);
    expect(mocks.anonFrom).toHaveBeenCalledWith("subscribers");
    expect(mocks.anonInsert).toHaveBeenCalledWith({
      store_id: UUID_A,
      email: "fan@example.test",
      consent_email: true,
      unsubscribe_token: "token"
    });
  });
});

describe("placeOrder", () => {
  it("rejects online orders before calling the placement RPC", async () => {
    await expect(placeOrder(orderInput({ paymentMode: "online" }))).resolves.toEqual({
      ok: false,
      error: "Online payment isn't ready for this stoop yet. Choose pay at pickup."
    });

    expect(mocks.orderRpc).not.toHaveBeenCalled();
  });

  it("rejects pay-at-pickup when the store disabled it before calling the RPC", async () => {
    mocks.storeMaybeSingle.mockResolvedValueOnce({
      data: { is_active: true, accept_pay_at_pickup: false },
      error: null
    });

    await expect(placeOrder(orderInput())).resolves.toEqual({
      ok: false,
      error: "This stoop isn't taking pay-at-pickup orders right now."
    });

    expect(mocks.orderRpc).not.toHaveBeenCalled();
  });
});
