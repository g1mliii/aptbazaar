"use server";

import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/log";
import { getStripe } from "@/lib/stripe/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 5.8: refund an order. v1 is full refunds only — stripe.refunds.create with no amount
// defaults to the whole charge. The payment_status flip to 'refunded' and the order_count_week
// decrement happen when the charge.refunded webhook lands (mark_order_refunded RPC); this action
// just initiates the refund and audit-logs the seller actor.
//
// The "Cancel & refund" button that calls this lives in the order detail panel (Phase 6.4); in
// Phase 5 the action ships and is covered by integration tests directly.

export type RefundResult = { ok: true } | { ok: false; error: string };

export async function refundOrder(orderId: string): Promise<RefundResult> {
  const parsed = z.string().uuid().safeParse(orderId);
  if (!parsed.success) {
    return { ok: false, error: "We couldn't find that order." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Please sign in." };
  }

  // RLS owner policy returns the row only if this seller owns the order's store — that is the
  // ownership check. Explicit columns, never select * against orders (hard invariant 6).
  const { data: order } = await supabase
    .from("orders")
    .select("id, payment_mode, payment_status, stripe_payment_intent_id, idempotency_key")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!order) {
    return { ok: false, error: "We couldn't find that order." };
  }
  if (order.payment_status === "refunded") {
    return { ok: false, error: "This order's already refunded." };
  }
  // Re-clicking an order whose refund is already in flight is a no-op, not an error — the cancel
  // flow leans on this so a double Cancel & refund doesn't fire a second Stripe refund.
  if (order.payment_status === "refund_pending") {
    return { ok: true };
  }
  if (order.payment_status !== "paid" || !order.stripe_payment_intent_id) {
    return { ok: false, error: "Only a paid online order can be refunded." };
  }

  try {
    // Destination charge: the funds settled on the seller's connected account and Stoop took an
    // application fee. A full refund must pull the transfer back from the connected account
    // (reverse_transfer) and return our fee (refund_application_fee) — otherwise the platform
    // balance funds the refund and the seller keeps both the sale and the fee.
    await getStripe().refunds.create(
      {
        payment_intent: order.stripe_payment_intent_id,
        reverse_transfer: true,
        refund_application_fee: true
      },
      { idempotencyKey: `${order.idempotency_key}:refund:0` }
    );
  } catch {
    return { ok: false, error: "Stripe couldn't process the refund. Try again." };
  }

  // Stripe accepted the refund (seconds) but the bank posting it (5–10 business days) is a separate
  // timeline, and the refund can still fail. Move to the in-between refund_pending state now; the
  // charge.refunded webhook confirms it to 'refunded', a refund-failure event flips it to
  // 'refund_failed'. The guarded paid→refund_pending update also serializes a double-click.
  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({ payment_status: "refund_pending" })
    .eq("id", order.id)
    .eq("payment_status", "paid")
    .select("id")
    .maybeSingle();
  if (updateError) {
    return {
      ok: false,
      error: "Stripe started the refund, but this order didn't update. Refresh and try again."
    };
  }
  if (!updated) {
    const { data: latest, error: reloadError } = await supabase
      .from("orders")
      .select("payment_status")
      .eq("id", order.id)
      .maybeSingle();
    if (
      reloadError ||
      !latest ||
      (latest.payment_status !== "refund_pending" &&
        latest.payment_status !== "refunded")
    ) {
      return {
        ok: false,
        error: "Stripe started the refund, but this order didn't update. Refresh and try again."
      };
    }
  }

  await writeAuditLog({
    actorType: "seller",
    actorId: user.id,
    action: "order.refund_initiated",
    targetTable: "orders",
    targetId: order.id,
    payload: { stripe_payment_intent_id: order.stripe_payment_intent_id }
  });

  return { ok: true };
}
