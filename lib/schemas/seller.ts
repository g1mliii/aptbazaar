import { z } from "zod";

import { email, phoneE164, timestamptz, uuid } from "./common";

export const sellerRowSchema = z.object({
  id: uuid,
  user_id: uuid,
  display_name: z.string().min(1),
  contact_email: email,
  contact_phone_e164: phoneE164.nullable(),
  contact_address: z.string().min(1).nullable(),
  created_at: timestamptz
});

export type Seller = z.infer<typeof sellerRowSchema>;
