import { Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/app/components/ui/button";
import { EmptyState } from "@/app/components/ui/empty-state";
import { requireSeller } from "@/lib/auth/session";
import { EMPTY_STATES } from "@/lib/copy/empty-states";
import { getRateLimitKv, remainingInWindow } from "@/lib/ratelimit/kv";
import { DROP_DAILY_LIMIT, dropWindowKey } from "@/lib/subscribers/drop-window";
import {
  countActiveRecipients,
  SUBSCRIBER_LIST_LIMIT
} from "@/lib/subscribers/recipients";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { SubscribersBoard, type SubscriberRow } from "./subscribers-board";

// Phase 6.6: the seller Subscribers screen. The server component owns the read (RLS gates it to the
// seller's own store); the board client component owns the KPIs, CSV export, drop composer, and the
// remove mutation. Explicit columns, never select * on subscribers (hard invariant 6). Email-only —
// no name/phone/SMS columns (kit drift logged: v1 is email-only / no-SMS).

export default async function SubscribersPage() {
  const seller = await requireSeller();
  const supabase = await createSupabaseServerClient();

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, slug")
    .eq("seller_id", seller.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let subscribers: SubscriberRow[] = [];
  let totalSubscriberCount = 0;
  let activeSubscriberCount = 0;
  if (store) {
    const [rowsResult, totalResult, activeCount] = await Promise.all([
      supabase
        .from("subscribers")
        .select("id, email, consent_email, verified_at, unsubscribed_at, created_at")
        .eq("store_id", store.id)
        .order("created_at", { ascending: false })
        .limit(SUBSCRIBER_LIST_LIMIT),
      supabase
        .from("subscribers")
        .select("id", { count: "exact", head: true })
        .eq("store_id", store.id),
      countActiveRecipients(supabase, store.id)
    ]);
    subscribers = rowsResult.data ?? [];
    totalSubscriberCount = totalResult.count ?? subscribers.length;
    activeSubscriberCount = activeCount;
  }

  // The daily window resets at UTC midnight, so what's left today is inherently time-dependent.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const remaining = store
    ? await remainingInWindow(
        getRateLimitKv(),
        dropWindowKey(store.id, now),
        DROP_DAILY_LIMIT
      )
    : DROP_DAILY_LIMIT;

  return (
    <section className="mx-auto max-w-4xl">
      {totalSubscriberCount === 0 ? (
        <>
          <h1 className="mb-5 font-display text-36 leading-none text-ink">
            Subscribers
          </h1>
          <EmptyState
            icon={Users}
            title={EMPTY_STATES.subscribers.title}
            body={EMPTY_STATES.subscribers.body}
            action={
              <Button asChild>
                <Link href="/dashboard/qr">Open your QR</Link>
              </Button>
            }
          />
        </>
      ) : (
        <SubscribersBoard
          subscribers={subscribers}
          totalSubscriberCount={totalSubscriberCount}
          activeSubscriberCount={activeSubscriberCount}
          contactAddress={seller.contact_address}
          dailyLimit={DROP_DAILY_LIMIT}
          remainingToday={remaining}
        />
      )}
    </section>
  );
}
