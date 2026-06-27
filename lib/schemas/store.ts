import { z } from "zod";

import { PUBLIC_SLUG_RE } from "@/lib/utils/slug";

import { timestamptz, uuid } from "./common";

export const storeVisibilitySchema = z.enum(["qr_only", "building", "nearby"]);
export const pickupMethodSchema = z.enum([
  "message_after_order",
  "lobby_pickup",
  "scheduled_window"
]);

export type StoreVisibility = z.infer<typeof storeVisibilitySchema>;
export type PickupMethod = z.infer<typeof pickupMethodSchema>;

export const storeRowSchema = z.object({
  id: uuid,
  seller_id: uuid,
  slug: z.string().regex(PUBLIC_SLUG_RE),
  name: z.string().min(1),
  category: z.string().nullable(),
  description: z.string().nullable(),
  logo_url: z.string().nullable(),
  is_active: z.boolean(),
  visibility: storeVisibilitySchema,
  pickup_method: pickupMethodSchema,
  pickup_window_label: z.string().nullable(),
  pickup_public_note: z.string().nullable(),
  pickup_private_note: z.string().nullable(),
  accept_pay_at_pickup: z.boolean(),
  order_count_week: z.number().int().nonnegative(),
  // Per-day order cap (null = unlimited) + its lazily-reset daily counter. orders_today only counts
  // for orders_today_date; place_order resets it on the first order of a new America/Toronto day.
  orders_per_day_limit: z.number().int().positive().nullable(),
  orders_today: z.number().int().nonnegative(),
  orders_today_date: timestamptz.nullable(),
  // Building grouping key (street|POSTAL). Maintained by updateContactInfo; never on a public surface.
  normalized_key: z.string().nullable(),
  first_scan_at: timestamptz.nullable(),
  first_scan_seen_at: timestamptz.nullable(),
  created_at: timestamptz,
  updated_at: timestamptz
});

export type Store = z.infer<typeof storeRowSchema>;

// Phase 8.2: the public projection of a store as it appears in a building bazaar / cross-link.
// Explicitly omits seller_id, normalized_key, pickup_private_note, and every other PII field —
// this is the only store shape that may cross the anon boundary on a bazaar page.
export const storePublicCardSchema = z.object({
  id: uuid,
  slug: z.string().regex(PUBLIC_SLUG_RE),
  name: z.string().min(1),
  category: z.string().nullable(),
  logo_url: z.string().nullable(),
  order_count_week: z.number().int().nonnegative(),
  created_at: timestamptz
});

export type StorePublicCard = z.infer<typeof storePublicCardSchema>;
