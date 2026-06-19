import "server-only";

import { optionalEnv, requiredEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email/send-email";
import {
  buildCustomerOrderEmail,
  buildSellerOrderEmail,
  type OrderEmailLine
} from "@/lib/email/templates/order-confirmation";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

// Phase 4.5: order confirmation emails. One to the customer (tracking URL), one to the seller
// (dashboard). Sent after a successful, non-replayed placeOrder. These are transactional, so
// no unsubscribe link is required — but they still carry the physical-address footer.

function appBaseUrl(): string {
  return requiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/+$/, "");
}

export async function sendOrderConfirmationEmails(args: {
  orderId: string;
  token: string;
}): Promise<void> {
  const supabase = createSupabaseSecretClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "customer_name, customer_email, total_cents, currency, payment_mode, pickup_window, store_id"
    )
    .eq("id", args.orderId)
    .single();
  if (!order) return;

  const [{ data: items }, { data: store }] = await Promise.all([
    supabase
      .from("order_items")
      .select("name_at_purchase, quantity, price_cents_at_purchase")
      .eq("order_id", args.orderId),
    supabase
      .from("stores")
      .select("name, slug, seller_id")
      .eq("id", order.store_id)
      .single()
  ]);
  if (!store) return;

  const { data: seller } = await supabase
    .from("sellers")
    .select("contact_email")
    .eq("id", store.seller_id)
    .single();

  const lines: OrderEmailLine[] = (items ?? []).map((i) => ({
    name: i.name_at_purchase,
    quantity: i.quantity,
    priceCents: i.price_cents_at_purchase
  }));

  const footerAddress = optionalEnv("STOOP_MAILING_ADDRESS");
  const base = appBaseUrl();

  const customerEmail = buildCustomerOrderEmail({
    storeName: store.name,
    customerName: order.customer_name,
    trackingUrl: `${base}/o/${args.token}`,
    lines,
    totalCents: order.total_cents,
    paymentMode: order.payment_mode,
    pickupWindow: order.pickup_window,
    footerAddress
  });

  const sends: Promise<unknown>[] = [
    sendEmail({ to: order.customer_email, ...customerEmail })
  ];

  if (seller?.contact_email) {
    const sellerEmail = buildSellerOrderEmail({
      storeName: store.name,
      customerName: order.customer_name,
      dashboardUrl: `${base}/dashboard/orders`,
      lines,
      totalCents: order.total_cents,
      paymentMode: order.payment_mode,
      pickupWindow: order.pickup_window,
      footerAddress
    });
    sends.push(sendEmail({ to: seller.contact_email, ...sellerEmail }));
  }

  await Promise.all(sends);
}
