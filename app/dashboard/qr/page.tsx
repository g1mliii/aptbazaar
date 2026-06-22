import Image from "next/image";

import { Seal } from "@/app/components/ui/seal";
import { requireSeller } from "@/lib/auth/session";
import { brandedStorefrontQrSvg, storefrontUrl } from "@/lib/qr/poster";
import type { PickupMethod } from "@/lib/schemas/store";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { QrPosterActions } from "./qr-poster-actions";
import { SharingSummary, type ScanChannel } from "./sharing-summary";

function pickupLabel(method: PickupMethod, windowLabel: string | null): string {
  switch (method) {
    case "lobby_pickup":
      return "Lobby / front desk pickup";
    case "scheduled_window":
      return windowLabel ?? "Pickup at a set window";
    case "message_after_order":
    default:
      return "We'll message you after your order";
  }
}

function scanCount(value: number | string | null): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export default async function QrPage({
  searchParams
}: {
  searchParams: Promise<{ first?: string }>;
}) {
  const seller = await requireSeller();
  const { first } = await searchParams;
  const isFirstLoad = first === "1";

  const supabase = await createSupabaseServerClient();
  const { data: store } = await supabase
    .from("stores")
    .select("id, slug, name, pickup_method, pickup_window_label")
    .eq("seller_id", seller.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!store) {
    return (
      <section className="mx-auto max-w-2xl">
        <h1 className="font-display text-28 text-ink">QR &amp; sharing</h1>
        <p className="mt-2 text-15 text-ink-2">
          Your stoop is still being set up. Add a store to generate a QR.
        </p>
      </section>
    );
  }

  const url = storefrontUrl(store.slug);
  const svgMarkupPromise = brandedStorefrontQrSvg(store.slug);
  // Per-channel scan totals are grouped in SQL (owner-only via RLS inside the invoker RPC). A read
  // error degrades to the empty summary rather than failing the page.
  const scanSummaryPromise = supabase.rpc("get_store_scan_summary", {
    p_store_id: store.id
  });
  const [svgMarkup, { data: scanRows }] = await Promise.all([
    svgMarkupPromise,
    scanSummaryPromise
  ]);
  const svgDataUri = `data:image/svg+xml,${encodeURIComponent(svgMarkup)}`;

  const channels: ScanChannel[] = (scanRows ?? []).map((row) => ({
    src: row.src,
    count: scanCount(row.count)
  }));

  return (
    <section className="mx-auto max-w-3xl">
      {isFirstLoad ? (
        <div className="mb-6 flex items-center gap-4 rounded-md border border-line bg-surface px-5 py-4 shadow-sm print:hidden">
          <Seal status="paid">Open</Seal>
          <div>
            <p className="font-display text-20 text-ink">Your stoop is open</p>
            <p className="text-14 text-ink-2">
              Print this QR, stick it somewhere people walk past, and you&apos;re taking
              orders.
            </p>
          </div>
        </div>
      ) : (
        <header className="mb-6 print:hidden">
          <h1 className="font-display text-28 text-ink">QR &amp; sharing</h1>
          <p className="mt-1 text-15 text-ink-2">
            Print your QR poster or share your storefront link.
          </p>
        </header>
      )}

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr] lg:items-start">
        <article className="mx-auto w-full max-w-sm rounded-xl border border-line bg-surface p-8 text-center shadow-stamp">
          <p className="font-display text-28 text-ink">{store.name}</p>
          <p className="mt-1 text-14 text-ink-3">
            {pickupLabel(store.pickup_method, store.pickup_window_label)}
          </p>
          <Image
            alt="QR code for your Stoop storefront"
            className="mx-auto mt-6 h-56 w-56"
            height={224}
            src={svgDataUri}
            unoptimized
            width={224}
          />
          <p className="mt-6 text-16 font-semibold text-ink">Scan to order</p>
          <p className="mt-1 font-mono text-13 text-ink-3 break-all">{url}</p>
        </article>

        <div className="space-y-8 lg:pt-2">
          <QrPosterActions storefrontUrl={url} />

          <div className="print:hidden">
            <SharingSummary channels={channels} />
          </div>
        </div>
      </div>
    </section>
  );
}
