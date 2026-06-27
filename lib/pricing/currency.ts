// Phase 5.10: single source of truth for currency. v1 is CAD-only; the post-MVP USD switch
// touches this file (and a per-store override) and nothing else. Money is always integer cents
// internally — this is the only place cents are rendered for display.

/** The only currency Stoop transacts in for v1. Lowercase to match Stripe's API. */
export const DEFAULT_CURRENCY = "cad" as const;

export type Currency = typeof DEFAULT_CURRENCY;

/**
 * Format integer cents for display: `$12` (whole dollars) or `$12.50`. No trailing zero cents on
 * whole dollars, matching the kit's price treatment. CAD-only in v1 — renders with a bare `$`
 * (single currency, no disambiguating prefix needed).
 */
export function formatMoney(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  const wholeDollars = safe % 100 === 0;
  return new Intl.NumberFormat("en-CA", {
    currency: "CAD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
    minimumFractionDigits: wholeDollars ? 0 : 2,
    style: "currency"
  }).format(safe / 100);
}

/**
 * Format a price for display, rendering `$0` as the giveaway label `Free`. This is the single rule
 * for the $0 case — call sites should not branch on `cents === 0` themselves.
 */
export function formatPrice(cents: number): string {
  return cents === 0 ? "Free" : formatMoney(cents);
}
