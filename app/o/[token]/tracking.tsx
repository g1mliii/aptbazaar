"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Receipt } from "@/app/components/ui/receipt";
import { Stamp } from "@/app/components/ui/stamp";
import { Toast } from "@/app/components/ui/toast";
import { resumeCheckout } from "@/lib/actions/checkout";
import { cn } from "@/lib/utils/cn";
import {
  orderStatusSchema,
  paymentStatusSchema,
  type OrderStatus,
  type PaymentMode,
  type PaymentStatus
} from "@/lib/schemas/order";
import type { TrackedItem } from "@/lib/orders/tracking";
import { formatMoney } from "@/lib/pricing/currency";

// Phase 4.6: order tracking view. Matches OrderTracking.jsx.
//
// Live updates are DEFERRED TO PHASE 6 (SSE via Cloudflare Worker + Durable Object), which is
// built alongside the order-status publish side that drives it. The Phase 4 stand-in is a
// refetch: poll on a modest interval and whenever the tab regains focus. The marked seam below
// is where the EventSource subscription replaces the poll.

const FLOW: { key: OrderStatus; label: string }[] = [
  { key: "new", label: "Order placed" },
  { key: "accepted", label: "Accepted" },
  { key: "preparing", label: "Preparing your order" },
  { key: "ready", label: "Ready for pickup" },
  { key: "complete", label: "Picked up" }
];

const STAMP_LABEL: Record<OrderStatus, string> = {
  new: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  complete: "Picked up",
  cancelled: "Cancelled"
};

// Reconciliation poll. POLL_MS is the tight interval used whenever SSE is down (and always for
// online orders, whose payment/refund state arrives only through the poll). SSE_RECONCILE_MS is the
// relaxed backstop kept running while SSE is healthy: publishOrderUpdate is best-effort, so a missed
// frame on a still-open stream is still corrected within this window rather than waiting for a tab
// refocus or reconnect.
const POLL_MS = 20_000;
const SSE_RECONCILE_MS = 60_000;

// Customer-facing refund copy. refund_failed is a seller problem to fix (Stripe handoff in the
// dashboard), so the customer just sees a neutral "we're on it" line — never an error code.
const REFUND_COPY: Partial<Record<PaymentStatus, string>> = {
  refund_pending: "Refund started.",
  refunded: "Refund sent. Your bank may take 5–10 business days to show it.",
  refund_failed:
    "There's a problem with your refund — the seller has been notified."
};

type TrackingProps = {
  token: string;
  orderRef: string;
  initialStatus: OrderStatus;
  paymentMode: PaymentMode;
  paymentStatus: PaymentStatus;
  storeName: string;
  storeSlug: string | null;
  pickupWindow: string | null;
  pickupNote: string | null;
  totalCents: number;
  items: TrackedItem[];
  notesShared: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return orderStatusSchema.safeParse(value).success;
}

function isPaymentStatus(value: unknown): value is PaymentStatus {
  return paymentStatusSchema.safeParse(value).success;
}

export function Tracking({
  token,
  orderRef,
  initialStatus,
  paymentMode,
  paymentStatus,
  storeName,
  storeSlug,
  pickupWindow,
  pickupNote,
  totalCents,
  items,
  notesShared
}: TrackingProps) {
  const [status, setStatus] = useState<OrderStatus>(initialStatus);
  const [currentPaymentStatus, setCurrentPaymentStatus] =
    useState<PaymentStatus>(paymentStatus);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, startPaying] = useTransition();

  // An online order that hasn't been paid yet (customer bailed at Stripe, the session expired, or a
  // card was declined → 'failed'). "Pay now" mints a live Checkout session (5.5a) so the order
  // never dead-ends; a declined attempt stays recoverable.
  const needsPayment =
    paymentMode === "online" &&
    (currentPaymentStatus === "unpaid" || currentPaymentStatus === "failed");

  function payNow() {
    setPayError(null);
    startPaying(async () => {
      const result = await resumeCheckout(token);
      if (result.ok) {
        window.location.href = result.url;
        return;
      }
      setPayError(result.error);
    });
  }

  const applyData = useCallback((data: unknown) => {
    if (!isRecord(data)) return;
    if (isOrderStatus(data.orderStatus)) setStatus(data.orderStatus);
    if (isPaymentStatus(data.paymentStatus)) {
      setCurrentPaymentStatus(data.paymentStatus);
    }
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/track/${token}`, { cache: "no-store" });
      if (!res.ok) return;
      applyData(await res.json());
    } catch {
      // Offline / transient — the next tick or focus retries.
    }
  }, [token, applyData]);

  useEffect(() => {
    // Live updates over SSE (Phase 6.0c) with a reconciliation poll that never fully stops. Online
    // orders poll at the tight interval throughout, because Stripe webhook payment/refund changes are
    // not published to the stream — only seller-driven status is. Pay-at-pickup orders DO ride the
    // stream for every change (status and markPaid), but publishOrderUpdate is best-effort, so once
    // SSE is healthy we relax the poll to the slower backstop rather than removing it: a missed frame
    // on a still-open stream is still corrected within SSE_RECONCILE_MS.
    const sseHealthyInterval = paymentMode === "online" ? POLL_MS : SSE_RECONCILE_MS;

    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);

    let pollId: ReturnType<typeof setInterval> | null = null;
    const setPoll = (intervalMs: number) => {
      if (pollId !== null) clearInterval(pollId);
      pollId = setInterval(() => void refetch(), intervalMs);
    };

    setPoll(POLL_MS);

    let es: EventSource | null = null;
    if (typeof EventSource !== "undefined") {
      es = new EventSource(`/api/track/${token}/stream`);
      es.onopen = () => setPoll(sseHealthyInterval);
      es.addEventListener("status", (event) => {
        try {
          applyData(JSON.parse(event.data as string));
        } catch {
          // Ignore a malformed frame; the next one or the poll corrects it.
        }
      });
      es.onerror = () => {
        // Stream dropped: tighten the poll back up and reconcile right away.
        setPoll(POLL_MS);
        void refetch();
      };
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      es?.close();
      if (pollId !== null) clearInterval(pollId);
    };
  }, [refetch, applyData, token, paymentMode]);

  const cancelled = status === "cancelled";
  const activeIdx = FLOW.findIndex((s) => s.key === status);
  const refundCopy = REFUND_COPY[currentPaymentStatus];

  const receiptLines = items.map((i) => ({
    label: `${i.quantity}× ${i.name}`,
    value: formatMoney(i.priceCents * i.quantity)
  }));

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <div className="text-center">
        <Stamp className="text-15" status={status}>
          {STAMP_LABEL[status]}
        </Stamp>
      </div>

      <h1 className="mt-4 text-center font-display text-36 leading-tight text-ink">
        {cancelled
          ? "This order was cancelled."
          : needsPayment
            ? "Finish your payment."
            : "Your order is in."}
      </h1>
      <p className="mt-1 text-center font-sans text-15 text-ink-2">
        {cancelled
          ? `${storeName} cancelled this order. Reach out if that's a surprise.`
          : needsPayment
            ? `${storeName} holds this order until you pay.`
            : `${storeName} will let you know the moment it's ready.`}
      </p>
      <p className="mt-2 text-center font-mono text-12 uppercase tracking-[0.08em] text-ink-3">
        Order {orderRef} · tracking link saved
      </p>

      {refundCopy ? (
        <Card className="mt-6">
          <p className="text-center font-sans text-14 text-ink">{refundCopy}</p>
        </Card>
      ) : null}

      {needsPayment ? (
        <Card className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-15 font-bold tabular-nums text-ink">
              {formatMoney(totalCents)}
            </span>
            <Button disabled={paying} onClick={payNow} type="button" variant="primary">
              {paying ? "Opening checkout…" : "Pay now"}
            </Button>
          </div>
          {payError ? (
            <Toast className="mt-3 w-full justify-center" tone="danger">
              {payError}
            </Toast>
          ) : null}
        </Card>
      ) : null}

      {!cancelled ? (
        <Card className="mt-6">
          <ol className="space-y-3">
            {FLOW.map((step, i) => {
              const done = i < activeIdx;
              const active = i === activeIdx;
              return (
                <li className="flex items-center gap-3" key={step.key}>
                  <span
                    className={cn(
                      "h-3 w-3 shrink-0 rounded-pill border",
                      done && "border-verdigris bg-verdigris",
                      active && "border-verdigris bg-verdigris-3",
                      !done && !active && "border-line bg-surface"
                    )}
                  />
                  <span
                    className={cn(
                      "font-sans text-14",
                      i <= activeIdx ? "text-ink" : "text-ink-3"
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}

      {notesShared ? (
        <Card className="mt-4">
          <p className="font-mono text-12 uppercase tracking-[0.08em] text-ink-3">
            A note from {storeName}
          </p>
          <p className="mt-2 font-sans text-14 text-ink">{notesShared}</p>
        </Card>
      ) : null}

      <div className="mt-4 space-y-4">
        <Receipt
          lines={
            pickupWindow || pickupNote
              ? [
                  ...receiptLines,
                  {
                    label: "Pickup",
                    value: pickupWindow ?? pickupNote ?? "After order"
                  }
                ]
              : receiptLines
          }
          number={orderRef}
          title="Order"
          total={formatMoney(totalCents)}
        />
      </div>

      {storeSlug ? (
        <div className="mt-6">
          <Button asChild className="w-full" variant="secondary">
            <Link href={`/s/${storeSlug}`}>Back to shop</Link>
          </Button>
        </div>
      ) : null}

      <p className="mt-6 text-center font-sans text-12 leading-relaxed text-ink-3">
        Save this page. The link in your email opens the same tracker.
        <br />
        No account needed.
      </p>
    </main>
  );
}
