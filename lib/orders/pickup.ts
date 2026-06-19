import type { PickupMethod } from "@/lib/schemas/store";

// Phase 4.3: the pickup choices a customer sees at checkout, derived from the store's pickup
// settings. "Message me" is always offered as a fallback. Pure + dependency-free for testing.

type PickupShape = {
  pickup_method: PickupMethod;
  pickup_window_label: string | null;
  pickup_public_note: string | null;
};

export function pickupOptionsFor(store: PickupShape): string[] {
  const options: string[] = [];
  if (store.pickup_method === "scheduled_window" && store.pickup_window_label) {
    options.push(store.pickup_window_label);
  }
  if (store.pickup_method === "lobby_pickup") {
    options.push(store.pickup_public_note ?? "Lobby / front desk pickup");
  }
  options.push("Message me — we'll coordinate");
  return Array.from(new Set(options));
}

// Phase 4.6: a short, human-friendly order reference drawn from the order id — never the raw uuid.
export function orderRefFrom(id: string): string {
  return `#${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}
