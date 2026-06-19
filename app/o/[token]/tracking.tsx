"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Receipt } from "@/app/components/ui/receipt";
import { Stamp } from "@/app/components/ui/stamp";
import { cn } from "@/lib/utils/cn";
import type { OrderStatus } from "@/lib/schemas/order";
import type { TrackedItem } from "@/lib/orders/tracking";
import { formatPriceCents } from "@/lib/utils/price";

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

type TrackingProps = {
  token: string;
  orderRef: string;
  initialStatus: OrderStatus;
  storeName: string;
  storeSlug: string | null;
  pickupWindow: string | null;
  pickupNote: string | null;
  totalCents: number;
  items: TrackedItem[];
};

export function Tracking({
  token,
  orderRef,
  initialStatus,
  storeName,
  storeSlug,
  pickupWindow,
  pickupNote,
  totalCents,
  items
}: TrackingProps) {
  const [status, setStatus] = useState<OrderStatus>(initialStatus);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/track/${token}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: { orderStatus?: OrderStatus } = await res.json();
      if (data.orderStatus) setStatus(data.orderStatus);
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
    value: formatPriceCents(i.priceCents * i.quantity)
  }));

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <div className="text-center">
        <Stamp className="text-15" status={status}>
          {STAMP_LABEL[status]}
        </Stamp>
      </div>

      <h1 className="mt-4 text-center font-display text-36 leading-tight text-ink">
        {cancelled ? "This order was cancelled." : "Your order is in."}
      </h1>
      <p className="mt-1 text-center font-sans text-15 text-ink-2">
        {cancelled
          ? `${storeName} cancelled this order. Reach out if that's a surprise.`
          : `${storeName} will let you know the moment it's ready.`}
      </p>
      <p className="mt-2 text-center font-mono text-12 uppercase tracking-[0.08em] text-ink-3">
        Order {orderRef} · tracking link saved
      </p>

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
          total={formatPriceCents(totalCents)}
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
