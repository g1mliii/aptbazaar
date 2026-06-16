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
