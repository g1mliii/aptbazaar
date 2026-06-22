import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  accountFlags: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  createSecret: vi.fn(),
  eq: vi.fn(),
  from: vi.fn(),
  getConnectedAccountByStripeId: vi.fn(),
  getStripe: vi.fn(),
  inFilter: vi.fn(),
  persistAccountFlags: vi.fn(),
  retrievePaymentIntent: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  sendPaymentConfirmationEmails: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
  update: vi.fn(),
  writeAuditLog: vi.fn()
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
  captureMessage: mocks.captureMessage
}));

vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: mocks.writeAuditLog
}));

vi.mock("@/lib/email/payment-confirmation", () => ({
  sendPaymentConfirmationEmails: mocks.sendPaymentConfirmationEmails,
  sendPaymentFailedEmail: mocks.sendPaymentFailedEmail
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: mocks.getStripe
}));

vi.mock("@/lib/stripe/connected-account", () => ({
  accountFlags: mocks.accountFlags,
  getConnectedAccountByStripeId: mocks.getConnectedAccountByStripeId,
  persistAccountFlags: mocks.persistAccountFlags
}));

vi.mock("@/lib/supabase/secret", () => ({
  createSupabaseSecretClient: mocks.createSecret
}));

import { processStripeEvent } from "@/lib/stripe/webhook-handlers";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function stripeEvent(type: string, object: Record<string, unknown>) {
  return { data: { object }, id: `evt_${type}`, type } as never;
}

beforeEach(() => {
  vi.clearAllMocks();

  const query = {
    eq: mocks.eq,
    in: mocks.inFilter,
    select: mocks.select
  };
  mocks.update.mockReturnValue(query);
  mocks.inFilter.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.from.mockReturnValue({ update: mocks.update });
  mocks.createSecret.mockReturnValue({
    from: mocks.from,
    rpc: mocks.rpc
  });
  mocks.select.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockResolvedValue({ data: ORDER_ID, error: null });
  mocks.writeAuditLog.mockResolvedValue(undefined);
  mocks.getStripe.mockReturnValue({
    paymentIntents: { retrieve: mocks.retrievePaymentIntent }
  });
});

describe("processStripeEvent", () => {
  it("throws when a checkout completion cannot update the order", async () => {
    mocks.select.mockResolvedValueOnce({
      data: null,
      error: { message: "orders table unavailable" }
    });

    await expect(
      processStripeEvent(
        stripeEvent("checkout.session.completed", {
          id: "cs_test",
          metadata: { order_id: ORDER_ID },
          payment_intent: "pi_test",
          payment_status: "paid"
        })
      )
    ).rejects.toThrow("orders paid update failed: orders table unavailable");

    expect(mocks.sendPaymentConfirmationEmails).not.toHaveBeenCalled();
  });

  it("throws when a payment failure cannot update the order", async () => {
    mocks.select.mockResolvedValueOnce({
      data: null,
      error: { message: "orders table unavailable" }
    });

    await expect(
      processStripeEvent(
        stripeEvent("payment_intent.payment_failed", {
          id: "pi_test",
          metadata: { order_id: ORDER_ID }
        })
      )
    ).rejects.toThrow("orders failed update failed: orders table unavailable");

    expect(mocks.sendPaymentFailedEmail).not.toHaveBeenCalled();
  });

  it("does not mark an order refunded for a partial Stripe refund", async () => {
    await expect(
      processStripeEvent(
        stripeEvent("charge.refunded", {
          amount: 600,
          amount_refunded: 200,
          id: "ch_partial",
          metadata: { order_id: ORDER_ID },
          payment_intent: "pi_test",
          refunded: false
        })
      )
    ).resolves.toBeUndefined();

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      actorType: "system",
      action: "order.partial_refund_observed",
      targetTable: "orders",
      targetId: ORDER_ID,
      payload: {
        amount: 600,
        amount_refunded: 200,
        stripe_charge_id: "ch_partial"
      }
    });
  });

  it("throws when a full-refund RPC fails", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "rpc unavailable" }
    });

    await expect(
      processStripeEvent(
        stripeEvent("charge.refunded", {
          amount: 600,
          amount_refunded: 600,
          id: "ch_full",
          metadata: { order_id: ORDER_ID },
          payment_intent: "pi_test",
          refunded: true
        })
      )
    ).rejects.toThrow("mark_order_refunded failed: rpc unavailable");

    expect(mocks.rpc).toHaveBeenCalledWith("mark_order_refunded", {
      p_order_id: ORDER_ID,
      p_charge_id: "ch_full",
      p_amount_refunded: 600
    });
  });

  it("flips a refund_pending order to refund_failed and alerts when a refund fails", async () => {
    // The guarded update matched a row, so the transition + audit + alert all fire.
    mocks.select.mockResolvedValueOnce({ data: [{ id: ORDER_ID }], error: null });

    await processStripeEvent(
      stripeEvent("charge.refund.updated", {
        id: "re_failed",
        status: "failed",
        failure_reason: "expired_or_canceled_card",
        metadata: { order_id: ORDER_ID },
        payment_intent: "pi_test"
      })
    );

    expect(mocks.update).toHaveBeenCalledWith({ payment_status: "refund_failed" });
    expect(mocks.inFilter).toHaveBeenCalledWith("payment_status", [
      "paid",
      "refund_pending"
    ]);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      actorType: "system",
      action: "order.refund_failed",
      targetTable: "orders",
      targetId: ORDER_ID,
      payload: { stripe_refund_id: "re_failed", failure_reason: "expired_or_canceled_card" }
    });
    expect(mocks.captureMessage).toHaveBeenCalled();
    // Stock must NOT be restored on a failed refund — that path runs no RPC.
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("handles a failed refund that arrives while the order is still paid", async () => {
    mocks.select.mockResolvedValueOnce({ data: [{ id: ORDER_ID }], error: null });

    await processStripeEvent(
      stripeEvent("refund.failed", {
        id: "re_early_failed",
        status: "failed",
        failure_reason: "expired_or_canceled_card",
        metadata: { order_id: ORDER_ID },
        payment_intent: "pi_test"
      })
    );

    expect(mocks.update).toHaveBeenCalledWith({ payment_status: "refund_failed" });
    expect(mocks.inFilter).toHaveBeenCalledWith("payment_status", [
      "paid",
      "refund_pending"
    ]);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "order.refund_failed",
        targetId: ORDER_ID
      })
    );
  });

  it("ignores a non-failed refund update (no state change, no alert)", async () => {
    await processStripeEvent(
      stripeEvent("charge.refund.updated", {
        id: "re_ok",
        status: "succeeded",
        metadata: { order_id: ORDER_ID },
        payment_intent: "pi_test"
      })
    );

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });
});
