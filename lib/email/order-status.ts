import "server-only";

import { appBaseUrl, optionalEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email/send-email";
import { buildOrderStatusEmail } from "@/lib/email/templates/order-status";
import { pickupNoteFor } from "@/lib/orders/tracking";
import type { OrderStatus } from "@/lib/schemas/order";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

// Phase 6.3: send the customer a status-transition email. Mirrors order-confirmation.ts — secret
// client, explicit-column reads, fetch the tracking token to build the URL. Customer only; the
// seller already lives in the dashboard. There is no email for `new` (the confirmation covers it),
// so the caller only fires this for accepted/preparing/ready/complete/cancelled. Best-effort: the
// caller wraps this in try/catch so a delivery hiccup never fails the status transition.

export async function sendOrderStatusEmail(args: {
  orderId: string;
  status: OrderStatus;
}): Promise<void> {
  if (args.status === "new") return;

  const supabase = createSupabaseSecretClient();

  const { data: order } = await supabase
    .from("orders")
    .select("customer_email, store_id")
    .eq("id", args.orderId)
    .single();
  if (!order) return;

  const [{ data: store }, { data: token }] = await Promise.all([
    supabase
      .from("stores")
      .select("name, pickup_method, pickup_window_label, pickup_public_note")
      .eq("id", order.store_id)
      .single(),
    supabase
      .from("order_tracking_tokens")
      .select("token")
      .eq("order_id", args.orderId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
  ]);
  if (!store || !token?.token) return;

  const email = buildOrderStatusEmail({
    status: args.status,
    storeName: store.name,
    trackingUrl: `${appBaseUrl()}/o/${token.token}`,
    pickupNote: pickupNoteFor(store),
    footerAddress: optionalEnv("STOOP_MAILING_ADDRESS")
  });

  await sendEmail({ to: order.customer_email, ...email });
}
