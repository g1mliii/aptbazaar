// Public storefront projections. Deliberately narrow: zero seller PII (no email, phone, address,
// or unit number ever reaches a public surface — hard invariants 2 and the Phase 4 privacy gate).

export type StorefrontStore = {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
  logo_url: string | null;
  pickup_method: "message_after_order" | "lobby_pickup" | "scheduled_window";
  pickup_window_label: string | null;
  pickup_public_note: string | null;
  accept_pay_at_pickup: boolean;
  order_count_week: number;
  // True when the store has hit its per-day order cap for today (computed server-side, same
  // America/Toronto day rule as place_order). The storefront shows a "fully booked" state instead
  // of the cart, and reopens automatically tomorrow.
  atCapacity: boolean;
};

export type StorefrontProduct = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  image_url: string | null;
  image_alt: string | null;
  qty_available: number | null;
  // Max quantity of this item allowed in one order (null = no per-order cap).
  max_per_order: number | null;
  allergens: string[];
};
