import { z } from "zod";

import { email, timestamptz, uuid } from "./common";

export const subscriberRowSchema = z.object({
  id: uuid,
  store_id: uuid,
  email,
  consent_email: z.boolean(),
  unsubscribe_token: z.string().min(1),
  verified_at: timestamptz.nullable(),
  unsubscribed_at: timestamptz.nullable(),
  created_at: timestamptz
});

export type Subscriber = z.infer<typeof subscriberRowSchema>;

// Storefront subscribe form (Phase 4.10). No phone / SMS field in v1.
export const subscriberInputSchema = z.object({
  storeId: uuid,
  email,
  consentEmail: z.literal(true, {
    message: "Check the box so we can email you about drops."
  })
});

export type SubscriberInput = z.infer<typeof subscriberInputSchema>;

// Drop composer input (Phase 6.5). The seller writes a subject + plain-text body; the audience is
// always all active email subscribers (no SMS / filter tabs in v1).
export const dropInputSchema = z.object({
  // Single line — a stray CR/LF would let a crafted subject inject extra mail headers downstream.
  subject: z
    .string()
    .trim()
    .min(1, "Add a subject.")
    .max(150)
    .refine((s) => !/[\r\n]/.test(s), "Keep the subject to a single line."),
  body: z.string().trim().min(1, "Write something to send.").max(5000)
});

export type DropInput = z.infer<typeof dropInputSchema>;
