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
import type { OrderStatus, PaymentMode, PaymentStatus } from "@/lib/schemas/order";
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

const POLL_MS = 20_000;
const ORDER_STATUSES: Record<OrderStatus, true> = {
  new: true,
  accepted: true,
  preparing: true,
  ready: true,
  complete: true,
  cancelled: true
};
const PAYMENT_STATUSES: Record<PaymentStatus, true> = {
  unpaid: true,
  pay_at_pickup: true,
  paid: true,
  refunded: true,
  failed: true
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && Object.hasOwn(ORDER_STATUSES, value);
}

function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && Object.hasOwn(PAYMENT_STATUSES, value);
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
  items
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

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/track/${token}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (!isRecord(data)) return;
      if (isOrderStatus(data.orderStatus)) setStatus(data.orderStatus);
      if (isPaymentStatus(data.paymentStatus)) {
        setCurrentPaymentStatus(data.paymentStatus);
      }
    } catch {
      // Offline / transient — the next tick or focus retries.
    }
  }, [token]);

  useEffect(() => {
    // Phase 6 seam: replace this poll with
    //   const es = new EventSource(`/api/track/${token}/stream`)
    //   es.addEventListener("status", (e) => setStatus(JSON.parse(e.data).orderStatus))
    const interval = setInterval(() => void refetch(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch]);

  const cancelled = status === "cancelled";
  const activeIdx = FLOW.findIndex((s) => s.key === status);

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
