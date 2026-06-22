import "server-only";

import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";

import { writeAuditLog } from "@/lib/audit/log";
import {
  sendPaymentConfirmationEmails,
  sendPaymentFailedEmail
} from "@/lib/email/payment-confirmation";
import {
  accountFlags,
  getConnectedAccountByStripeId,
  persistAccountFlags
} from "@/lib/stripe/connected-account";
import { getStripe } from "@/lib/stripe/client";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

// Phase 5.6/5.8/5.9: side effects for the durable webhook inbox. Each handler is idempotent —
// every order-state update is guarded so a Stripe redelivery is a no-op. Orders are linked to
// Stripe objects by `metadata.order_id` (stamped on the Checkout Session + PaymentIntent at
// creation), falling back to the stored session / payment-intent id.

function orderIdFromMetadata(
  metadata: Stripe.Metadata | null | undefined
): string | null {
  const value = metadata?.order_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function throwOnSupabaseError(
  context: string,
  error: { message?: string } | null | undefined
): void {
  if (error) {
    throw new Error(`${context} failed: ${error.message ?? "unknown Supabase error"}`);
  }
}

// Resolve our order id from a charge/dispute event. The durable link is metadata.order_id, which
// we stamp on the PaymentIntent at creation — it's available the instant the charge exists,
// independent of whether checkout.session.completed has been processed yet (events can arrive out
// of order). Try the object's own metadata first, then fall back to retrieving the PaymentIntent.
async function orderIdForPaymentIntent(
  paymentIntentId: string,
  ownMetadata?: Stripe.Metadata | null
): Promise<string | null> {
  const fromOwn = orderIdFromMetadata(ownMetadata);
  if (fromOwn) return fromOwn;
  try {
    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
    return orderIdFromMetadata(intent.metadata);
  } catch {
    return null;
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // Only a paid session transitions the order. (Sessions can complete in other states.)
  if (session.payment_status !== "paid") {
    return;
  }
  const orderId = orderIdFromMetadata(session.metadata);
  const paymentIntentId = asId(session.payment_intent);

  const supabase = createSupabaseSecretClient();
  let query = supabase
    .from("orders")
    .update({
      payment_status: "paid",
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: session.id
    })
    // A prior declined attempt may have left the order 'failed'; a later successful payment must
    // still promote it to 'paid'. Both states are pre-payment and recoverable.
    .in("payment_status", ["unpaid", "failed"]);
  query = orderId
    ? query.eq("id", orderId)
    : query.eq("stripe_checkout_session_id", session.id);

  const { data, error } = await query.select("id");
  throwOnSupabaseError("orders paid update", error);

  const [order] = data ?? [];
  // Only email on the real unpaid→paid transition, so a redelivery doesn't double-send.
  // Best-effort: the order is already marked paid; an email hiccup (or an unconfigured email
  // binding in local dev) must not fail the webhook and force a Stripe retry loop.
  if (order) {
    try {
      await sendPaymentConfirmationEmails(order.id);
    } catch (err) {
      Sentry.captureException(err);
    }
  }
}

async function handlePaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  const orderId = orderIdFromMetadata(intent.metadata);

  const supabase = createSupabaseSecretClient();
  let query = supabase
    .from("orders")
    .update({ payment_status: "failed" })
    .eq("payment_status", "unpaid");
  query = orderId
    ? query.eq("id", orderId)
    : query.eq("stripe_payment_intent_id", intent.id);

  const { data, error } = await query.select("id");
  throwOnSupabaseError("orders failed update", error);

  const [order] = data ?? [];
  if (order) {
    try {
      await sendPaymentFailedEmail(order.id);
    } catch (err) {
      Sentry.captureException(err);
    }
  }
}

async function handleChargeRefunded(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId = asId(charge.payment_intent);
  if (!paymentIntentId) return;
  const orderId = await orderIdForPaymentIntent(paymentIntentId, charge.metadata);
  if (!orderId) return;

  // Stripe emits charge.refunded for partial refunds too. Stoop v1 only models full refunds, so a
  // partial issued directly in Stripe must not flip the whole order to refunded or decrement the
  // order-count chip. The full-refund event has charge.refunded=true.
  if (!charge.refunded) {
    await writeAuditLog({
      actorType: "system",
      action: "order.partial_refund_observed",
      targetTable: "orders",
      targetId: orderId,
      payload: {
        stripe_charge_id: charge.id,
        amount_refunded: charge.amount_refunded,
        amount: charge.amount
      }
    });
    return;
  }

  const supabase = createSupabaseSecretClient();
  // Atomic flip + order_count_week decrement + audit row, in one transaction (migration 0026), so
  // a transient failure can't leave the order refunded without an audit trail. Returns null on a
  // redelivery (already refunded), changing nothing.
  const { error } = await supabase.rpc("mark_order_refunded", {
    p_order_id: orderId,
    p_charge_id: charge.id,
    p_amount_refunded: charge.amount_refunded
  });
  throwOnSupabaseError("mark_order_refunded", error);
}

async function handleRefundFailed(refund: Stripe.Refund): Promise<void> {
  // charge.refund.updated fires on every refund status change; only a genuinely failed refund moves
  // the order. (refund.failed, where enabled, carries an already-failed refund.)
  if (refund.status !== "failed") return;
  const paymentIntentId = asId(refund.payment_intent);
  if (!paymentIntentId) return;
  const orderId = await orderIdForPaymentIntent(paymentIntentId, refund.metadata);
  if (!orderId) return;

  const supabase = createSupabaseSecretClient();
  // paid/refund_pending → refund_failed. The failed event can arrive before the local
  // refund_pending write, so accept either pre-failure state. Do NOT restore stock/count: the money
  // never landed, so the order's inventory must stay consumed (the stock_restored marker is left
  // untouched).
  const { data, error } = await supabase
    .from("orders")
    .update({ payment_status: "refund_failed" })
    .eq("id", orderId)
    .in("payment_status", ["paid", "refund_pending"])
    .select("id");
  throwOnSupabaseError("orders refund_failed update", error);

  // Only audit + alert on the real transition, so a redelivery doesn't double-fire the founder alert.
  if ((data ?? []).length > 0) {
    await writeAuditLog({
      actorType: "system",
      action: "order.refund_failed",
      targetTable: "orders",
      targetId: orderId,
      payload: { stripe_refund_id: refund.id, failure_reason: refund.failure_reason ?? null }
    });
    Sentry.captureMessage(
      `Stripe refund failed for order ${orderId} (refund ${refund.id})`,
      "warning"
    );
  }
}

async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const paymentIntentId = asId(dispute.payment_intent);
  const orderId = paymentIntentId
    ? await orderIdForPaymentIntent(paymentIntentId, dispute.metadata)
    : null;

  await writeAuditLog({
    actorType: "system",
    action: "order.dispute_created",
    targetTable: "orders",
    targetId: orderId,
    payload: {
      stripe_dispute_id: dispute.id,
      reason: dispute.reason,
      amount: dispute.amount
    }
  });
  // Founder alert. Hard-freezing further actions on the order needs a dedicated column — tracked
  // for Phase 6's order detail panel; for now the audit row + alert surface it.
  Sentry.captureMessage(`Stripe dispute opened: ${dispute.id}`, "warning");
}

async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  const existing = await getConnectedAccountByStripeId(account.id);
  if (!existing) {
    // We only track accounts we created; ignore updates for unknown accounts.
    return;
  }
  const next = accountFlags(account);

  // The event fires on every onboarding change. Only a true→false regression of a capability is
  // worth alerting on — naively treating charges_enabled=false as a deauth would fire during
  // normal signup.
  const regressions = (
    ["charges_enabled", "details_submitted", "payouts_enabled"] as const
  ).filter((key) => existing[key] === true && next[key] === false);

  // Audit + alert BEFORE the sync. Regression detection compares against the stored row; if we
  // synced first and then a later step threw, the retry would read the already-regressed row, see
  // no change, and silently lose the alert. Doing it first means a transient failure at worst
  // re-fires the alert on retry rather than dropping it.
  if (regressions.length > 0) {
    await writeAuditLog({
      actorType: "system",
      action: "connect.capability_regressed",
      targetTable: "connected_accounts",
      targetId: existing.seller_id,
      payload: { stripe_account_id: account.id, regressions }
    });
    Sentry.captureMessage(
      `Connect account regressed (${account.id}): ${regressions.join(", ")}`,
      "warning"
    );
  }

  await persistAccountFlags(account);
}

/** Dispatch a verified Stripe event to its handler. Unknown types are a no-op. Throws on failure
 *  so the route records the error and lets Stripe retry. */
export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object);
      return;
    case "payment_intent.payment_failed":
      await handlePaymentFailed(event.data.object);
      return;
    case "charge.refunded":
      await handleChargeRefunded(event.data.object);
      return;
    // Refund-failure signal. The event name depends on the API version / payload: newer accounts
    // emit the top-level `refund.updated` / `refund.failed`; older ones `charge.refund.updated`.
    // All three carry a Refund object; handleRefundFailed only acts when status === "failed".
    case "refund.updated":
    case "charge.refund.updated":
    case "refund.failed":
      await handleRefundFailed(event.data.object);
      return;
    case "charge.dispute.created":
      await handleDisputeCreated(event.data.object);
      return;
    case "account.updated":
      await handleAccountUpdated(event.data.object);
      return;
    default:
      // Persisted in stripe_events but not acted on.
      return;
  }
}
