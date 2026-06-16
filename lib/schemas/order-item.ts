import { z } from "zod";

import { cents, uuid } from "./common";

export const orderItemRowSchema = z.object({
  id: uuid,
  order_id: uuid,
  product_id: uuid.nullable(),
  name_at_purchase: z.string().min(1),
  quantity: z.number().int().positive(),
  price_cents_at_purchase: cents
});

export type OrderItem = z.infer<typeof orderItemRowSchema>;
