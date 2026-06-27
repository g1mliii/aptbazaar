import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { requiredEnv } from "@/lib/env";
import { captureFailure } from "@/lib/observability/capture";
import { getStripe } from "@/lib/stripe/client";
import { processStripeEvent } from "@/lib/stripe/webhook-handlers";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import type { Json } from "@/lib/supabase/database.types";

// Phase 5.4: durable Stripe webhook inbox. Verify the signature, persist the raw event to
// stripe_events first (the durable inbox — hard invariant 5), then process it inline and stamp
// processed_at. Redelivery of an already-processed event is a no-op; a processing failure leaves
// processed_at null and returns 500 so Stripe retries and we reprocess on the next delivery.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature ?? "",
      requiredEnv("STRIPE_WEBHOOK_SECRET")
    );
  } catch {
    // Bad or missing signature — never trust the payload.
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const supabase = createSupabaseSecretClient();

  // Persist first. ignoreDuplicates makes a redelivery a no-op at the inbox layer.
  const { error: inboxError } = await supabase
    .from("stripe_events")
    .upsert(
      {
        stripe_event_id: event.id,
        type: event.type,
        payload_jsonb: event as unknown as Json
      },
      { onConflict: "stripe_event_id", ignoreDuplicates: true }
    );
  if (inboxError) {
    return NextResponse.json({ error: "webhook inbox unavailable" }, { status: 500 });
  }

  const { data: claimed, error: claimError } = await supabase.rpc("claim_stripe_event", {
    p_stripe_event_id: event.id
  });
  if (claimError) {
    return NextResponse.json({ error: "webhook inbox unavailable" }, { status: 500 });
  }

  // Already handled, or another delivery is currently processing it. Acknowledge without running
  // side effects twice; the active delivery will 500 and retry if processing actually fails.
  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await processStripeEvent(event);
    const { error: stampError } = await supabase
      .from("stripe_events")
      .update({
        processed_at: new Date().toISOString(),
        error: null,
        processing_started_at: null
      })
      .eq("stripe_event_id", event.id);
    if (stampError) {
      throw new Error(`stripe_events processed_at update failed: ${stampError.message}`);
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    captureFailure("stripe-webhook", err, { eventId: event.id, type: event.type });
    await supabase
      .from("stripe_events")
      .update({
        error: err instanceof Error ? err.message : String(err),
        processing_started_at: null
      })
      .eq("stripe_event_id", event.id);
    // Leave processed_at null so Stripe's retry reprocesses this event.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
