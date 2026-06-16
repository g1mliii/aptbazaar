import { z } from "zod";

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
  slug: z.string().regex(/^[a-z0-9-]{1,40}$/),
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
  first_scan_at: timestamptz.nullable(),
  first_scan_seen_at: timestamptz.nullable(),
  created_at: timestamptz,
  updated_at: timestamptz
});

export type Store = z.infer<typeof storeRowSchema>;
