import "server-only";

import type Stripe from "stripe";

import { appBaseUrl } from "@/lib/env";
import { DEFAULT_CURRENCY } from "@/lib/pricing/currency";
import { computePlatformFee } from "@/lib/pricing/fee";
import { getStripe } from "@/lib/stripe/client";
import { getConnectedAccount } from "@/lib/stripe/connected-account";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

// Phase 5.5: Stripe Checkout session creation, destination-charge model. The PaymentIntent lives
// on the platform account; funds settle to the seller's connected account via
// transfer_data.destination, and Stoop's fee is taken via application_fee_amount. We never custody
// funds (hard invariant 4). order_id is stamped on both the session and the payment intent so
// every downstream webhook can link back to our order.

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Create a Checkout Session for an existing unpaid online order and persist its id.
 * `attempt` becomes the idempotency-key suffix (`<key>:checkout:<attempt>`) so a retry after an
 * expired session doesn't collide with the original on Stripe's idempotency layer.
 */
export async function createOrderCheckoutSession(params: {
  orderId: string;
  token: string;
  attempt: number;
}): Promise<CheckoutResult> {
  const supabase = createSupabaseSecretClient();

  // order and order_items are both keyed by orderId and don't depend on each other — read together.
  const [{ data: order }, { data: items }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, store_id, total_cents, idempotency_key, customer_email")
      .eq("id", params.orderId)
      .single(),
    supabase
      .from("order_items")
      .select("name_at_purchase, quantity, price_cents_at_purchase")
      .eq("order_id", params.orderId)
  ]);
  if (!order) {
    return { ok: false, error: "We couldn't find that order." };
  }
  if (!items || items.length === 0) {
    return { ok: false, error: "That order has no items." };
  }
  // A $0 (free/giveaway) order never belongs in Stripe — it rejects zero-amount charges, and the
  // order is already settled on placement. Guard here so a stray online-mode $0 order can't reach
  // the API; the storefront routes all-free carts to the 'free' settle path instead.
  if (order.total_cents <= 0) {
    return { ok: false, error: "This order is free — no payment needed." };
  }

  const { data: store } = await supabase
    .from("stores")
    .select("seller_id")
    .eq("id", order.store_id)
    .single();
  if (!store) {
    return { ok: false, error: "We couldn't find that store." };
  }

  const connected = await getConnectedAccount(store.seller_id);
  if (!connected?.charges_enabled) {
    return { ok: false, error: "Online payment isn't set up for this stoop yet." };
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((item) => ({
    quantity: item.quantity,
    price_data: {
      currency: DEFAULT_CURRENCY,
      unit_amount: item.price_cents_at_purchase,
      product_data: { name: item.name_at_purchase }
    }
  }));

  const base = appBaseUrl();
  const trackingUrl = `${base}/o/${params.token}`;

  try {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: "payment",
        line_items: lineItems,
        customer_email: order.customer_email,
        success_url: `${trackingUrl}?paid=1`,
        cancel_url: trackingUrl,
        metadata: { order_id: order.id },
        payment_intent_data: {
          application_fee_amount: computePlatformFee(order.total_cents),
          transfer_data: { destination: connected.stripe_account_id },
          metadata: { order_id: order.id }
        }
      },
      { idempotencyKey: `${order.idempotency_key}:checkout:${params.attempt}` }
    );

    if (!session.url) {
      return { ok: false, error: "Stripe didn't return a checkout link. Try again." };
    }

    await supabase
      .from("orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", order.id);

    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "We couldn't start checkout. Try again in a moment." };
  }
}
