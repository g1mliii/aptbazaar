import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState } from "@/app/components/ui/empty-state";
import { orderRefFrom } from "@/lib/orders/pickup";
import { loadTracking } from "@/lib/orders/tracking";

import { Tracking } from "./tracking";

// Phase 4.6: order tracking, no login. The 128-bit token is the only identity (hard invariant 3).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your order · Stoop" };

export default async function OrderTrackingPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await loadTracking(token);

  if (result.status === "unknown") {
    notFound();
  }

  if (result.status === "expired") {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-md items-center px-4">
        <EmptyState
          body="This tracking link has expired. Check your email for the latest one, or ask the seller."
          className="w-full"
          title="This link's expired."
        />
      </main>
    );
  }

  const { order, items, store, notesShared } = result;

  return (
    <Tracking
      initialStatus={order.order_status}
      items={items}
      notesShared={notesShared}
      orderRef={orderRefFrom(order.id)}
      paymentMode={order.payment_mode}
      paymentStatus={order.payment_status}
      pickupNote={store.pickupNote}
      pickupWindow={order.pickup_window}
      storeName={store.name}
      storeSlug={store.slug}
      token={token}
      totalCents={order.total_cents}
    />
  );
}
