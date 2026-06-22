import { Package } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";

import { OnboardingNudge } from "@/app/components/onboarding/onboarding-nudge";
import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { NUDGE_DISMISSED_COOKIE } from "@/lib/cookie-names";
import { EMPTY_STATES } from "@/lib/copy/empty-states";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { FirstScanSeal } from "./first-scan-seal";
import { OrdersBoard, type BoardOrder } from "./orders-board";

// Phase 6.2: the seller Orders screen. The server component owns the read (RLS gates it to the
// seller's own store); the board client component owns filters, the detail panel, optimistic
// transitions, and the cancel/mark-paid/notes mutations. Explicit columns, never select * on
// orders (hard invariant 6).

export default async function OrdersPage() {
  const supabase = await createSupabaseServerClient();
  const cookieStore = await cookies();
  const nudgeDismissed = cookieStore.get(NUDGE_DISMISSED_COOKIE)?.value === "1";

  const { data: store } = await supabase
    .from("stores")
    .select("id, first_scan_at, first_scan_seen_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // The first-scan ceremony fires once: first_scan_at stamped by the beacon, not yet acknowledged.
  const showFirstScan = !!store?.first_scan_at && !store?.first_scan_seen_at;

  let orders: BoardOrder[] = [];
  if (store) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, customer_name, customer_email, customer_phone_e164, total_cents, order_status, payment_status, payment_mode, pickup_window, pickup_time, notes, notes_seller, notes_shared, created_at, order_items(name_at_purchase, quantity, price_cents_at_purchase)"
      )
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(50);
    orders = data ?? [];
  }

  return (
    <section className="mx-auto max-w-5xl">
      <h1 className="mb-5 font-display text-36 leading-none text-ink">Orders</h1>

      {showFirstScan ? (
        <FirstScanSeal storeId={store.id} />
      ) : !nudgeDismissed ? (
        <OnboardingNudge />
      ) : null}

      {orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title={EMPTY_STATES.orders.title}
          body={EMPTY_STATES.orders.body}
          action={
            <Button asChild>
              <Link href="/dashboard/qr">Open your QR</Link>
            </Button>
          }
        />
      ) : (
        <OrdersBoard orders={orders} />
      )}
    </section>
  );
}
