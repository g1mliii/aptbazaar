import Image from "next/image";

import { Card } from "@/app/components/ui/card";

import type { StorefrontStore } from "./types";

// Phase 4.1: store identity card. Matches ui_kits/storefront/StoreHeader.jsx — logo, category,
// display-serif name, description, an "Open today" pill, and the order-count social-proof chip
// (mono number) shown only when there's at least one order (Phase 4.7).

function pickupLine(store: StorefrontStore): string | null {
  if (store.pickup_public_note) return store.pickup_public_note;
  switch (store.pickup_method) {
    case "lobby_pickup":
      return "Lobby / front desk pickup";
    case "scheduled_window":
      return store.pickup_window_label ?? "Pickup at a set time";
    default:
      return "Pickup details after you order";
  }
}

export function StoreHeader({
  store,
  open = true
}: {
  store: StorefrontStore;
  open?: boolean;
}) {
  const initial = store.name.trim().charAt(0).toUpperCase() || "S";
  const pickup = pickupLine(store);

  return (
    <Card className="rounded-xl">
      <div className="flex items-center gap-3">
        {store.logo_url ? (
          <Image
            alt=""
            className="h-12 w-12 rounded-md object-cover"
            height={48}
            src={store.logo_url}
            width={48}
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-verdigris font-display text-24 text-surface">
            {initial}
          </div>
        )}
        {store.category ? (
          <span className="ab-eyebrow text-ink-3">{store.category}</span>
        ) : null}
      </div>

      <h1 className="mt-3 font-display text-36 leading-none text-ink">
        {store.name}
      </h1>
      {store.description ? (
        <p className="ab-body mt-2 text-ink-2">{store.description}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {open ? (
          <span className="inline-flex items-center rounded-pill border border-line bg-success-3 px-3 py-1 font-sans text-12 font-semibold text-success">
            Open today
          </span>
        ) : null}
        {store.order_count_week >= 1 ? (
          <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-paper-2 px-3 py-1 font-sans text-12 text-ink-2">
            <span className="font-mono tabular-nums text-ink">
              {store.order_count_week}
            </span>
            {store.order_count_week === 1 ? "order" : "orders"} this week
          </span>
        ) : null}
      </div>

      {pickup ? <p className="ab-body-sm mt-3 text-ink-3">{pickup}</p> : null}
    </Card>
  );
}
