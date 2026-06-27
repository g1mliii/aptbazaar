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
  image_alt: z.string().nullable(),
  qty_available: z.number().int().nonnegative().nullable(),
  // Cap on how many of this item one order may contain (null = no per-order cap). Distinct from
  // qty_available (total stock): a giveaway can hold 20 in stock but allow "1 per person".
  max_per_order: z.number().int().positive().nullable(),
  is_active: z.boolean(),
  allergens: z.array(z.string()),
  ingredients: z.string().nullable(),
  created_at: timestamptz,
  updated_at: timestamptz
});

export type Product = z.infer<typeof productRowSchema>;

// Form / server-action input (Phase 3.4 add/edit product modal). qty_available null = unlimited.
export const productInputSchema = z
  .object({
    name: z.string().min(1, "Give your item a name.").max(120),
    description: z.string().max(2000).optional(),
    price_cents: cents,
    image_upload_id: uuid.nullish(),
    clear_image: z.boolean().optional(),
    // Phase 9.6: alt text is required (>= 3 chars) whenever a photo is attached, so a screen reader
    // can describe it. Optional otherwise (no image, or just editing other fields).
    image_alt: z.string().trim().max(120).optional(),
    qty_available: z.number().int().nonnegative().nullable().optional(),
    max_per_order: z.number().int().positive().nullable().optional(),
    is_active: z.boolean().default(true),
    allergens: z.array(z.string()).default([]),
    ingredients: z.string().max(2000).optional()
  })
  .superRefine((input, ctx) => {
    if (input.image_upload_id && (input.image_alt ?? "").trim().length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["image_alt"],
        message: "Describe the photo in a few words so everyone can picture it."
      });
    }
  });

export type ProductInput = z.infer<typeof productInputSchema>;
