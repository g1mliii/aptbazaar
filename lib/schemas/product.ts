import { z } from "zod";

import { cents, currency, timestamptz, uuid } from "./common";

export const productRowSchema = z.object({
  id: uuid,
  store_id: uuid,
  name: z.string().min(1),
  description: z.string().nullable(),
  price_cents: cents,
  currency,
  image_url: z.string().nullable(),
  qty_available: z.number().int().nonnegative().nullable(),
  is_active: z.boolean(),
  allergens: z.array(z.string()),
  ingredients: z.string().nullable(),
  created_at: timestamptz,
  updated_at: timestamptz
});

export type Product = z.infer<typeof productRowSchema>;

// Form / server-action input (Phase 3.4 add/edit product modal). qty_available null = unlimited.
export const productInputSchema = z.object({
  name: z.string().min(1, "Give your item a name."),
  description: z.string().max(2000).optional(),
  price_cents: cents,
  image_url: z.string().optional(),
  qty_available: z.number().int().nonnegative().nullable().optional(),
  is_active: z.boolean().default(true),
  allergens: z.array(z.string()).default([]),
  ingredients: z.string().max(2000).optional()
});

export type ProductInput = z.infer<typeof productInputSchema>;
