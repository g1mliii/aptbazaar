# Runbook: refunds and disputes

> Phase 10.2. How to handle refunds, stuck refunds, and Stripe disputes (chargebacks). Stoop owns
> almost none of the money UI — most of this routes you into Stripe's Express dashboard. Read
> `docs/runbooks/rollback.md` for deploy issues and `SECURITY.md` for disclosure.

## Mental model

- **Stoop never holds funds.** Every charge is a Stripe Connect destination charge: money settles on
  the seller's connected account and Stoop takes an `application_fee_amount`.
- **Refunds are seller-initiated, full-only in v1.** The only in-app entry point is the
  **Cancel & refund** button on the order detail panel (`/dashboard/orders` →
  `app/dashboard/orders/orders-board.tsx`). It calls `refundOrder` in `lib/actions/refunds.ts`.
- **Webhooks are the source of truth for state**, not the API response. The refund action moves the
  order to `refund_pending`; the `charge.refunded` webhook confirms it to `refunded`.

## A. Full refund (happy path)

1. Seller opens the order in `/dashboard/orders` and clicks **Cancel & refund**.
2. `refundOrder` calls Stripe with `reverse_transfer: true` + `refund_application_fee: true`
   (pulls the transfer back from the connected account and returns Stoop's fee), keyed by
   `<idempotency_key>:refund:0` so a double-click never fires a second refund.
3. Order flips `paid → refund_pending`, and an audit-log row is written
   (`action: "order.refund_initiated"`, seller actor).
4. Stripe sends `charge.refunded`; the webhook handler runs `mark_order_refunded`, flipping the
   order to `refunded`, restoring stock exactly once, and decrementing `order_count_week`.
5. The customer sees the refunded state on their tracking page. Bank posting takes 5–10 business days
   — that timeline is Stripe's, not ours.

**Nothing for the founder to do** in the happy path. The steps below are for when it doesn't go clean.

## B. Refund stuck in `refund_pending`

Symptom: order shows "Refund pending" for more than a few minutes and never reaches "Refunded".

1. **Confirm the refund exists in Stripe.** Open the Stripe dashboard → the connected account →
   Payments → find the payment intent (`stripe_payment_intent_id` on the order). Check whether a
   refund object exists and its status (`succeeded`, `pending`, `failed`).
2. **If the refund succeeded in Stripe but the order is still `refund_pending`:** the
   `charge.refunded` webhook didn't land or didn't process. Go to Stripe → Developers → Webhooks,
   find the `charge.refunded` event, and **Resend** it. Processing is idempotent (deduped by
   `stripe_event_id`), so resending is safe. Confirm the order flips to `refunded`.
3. **If the refund failed in Stripe:** the order should move to `refund_failed` once the
   `charge.refund.updated` / `refund.failed` event is enabled (Phase 6 manual step — verify it's on
   in the webhook config). If it isn't enabled, the order stays stuck in `refund_pending`. Enable the
   event, then resend it, or retry the refund from the order panel.
4. **If no refund exists in Stripe at all:** the action errored before creating it. Have the seller
   click **Cancel & refund** again — re-clicking a `refund_pending` order is a safe no-op, and a
   `paid` order will start a fresh refund.

## C. `refund_failed`

The order panel shows "Refund needs attention" with a link to the Stripe dashboard. A refund can fail
when the connected account lacks the balance to reverse the transfer.

1. Open the connected account in Stripe and check the available balance.
2. Refund (or partially refund) directly from Stripe once the balance covers it.
3. The corresponding webhook reconciles the order state. If it doesn't, resend the event (B-2).

## D. Partial refund / seller-disputed refund

Stoop does **not** do partial refunds in v1. If a seller wants to refund part of an order, or
disputes whether a refund should happen:

1. Do it from **Stripe's dashboard** on the connected account (Stripe owns refund history — Stoop has
   no partial-refund UI by design, invariant 10).
2. Note that a Stripe-side partial refund will **not** flip the Stoop order to `refunded` (we only
   react to full `charge.refunded`). The order keeps its current state; document this for the seller.
3. Log what you did and why in the founder support thread.

## E. Stripe dispute (chargeback)

A customer's bank reverses a charge. This is handled entirely in Stripe.

1. You'll be alerted via the founder email + Sentry (dispute alert routing). Open the dispute in
   Stripe → the connected account → Disputes.
2. Gather evidence with the seller: order details, pickup confirmation, any messages.
3. Submit evidence in Stripe before the deadline. The platform never custodies the funds — the
   dispute resolves on the connected account.
4. Tell the seller what's happening using the template below.

## Founder email template — disputed charge

> Subject: About order #<number>
>
> Hi <name>,
>
> A customer's bank opened a dispute on order #<number>, so the charge is on hold while it's
> reviewed. Nothing's gone wrong on your end yet — this happens, and we can respond with evidence.
>
> Could you reply with anything that shows the order was fulfilled? A pickup time, a photo, or your
> messages with the customer all help. I'll submit it through Stripe before the deadline on <date>.
>
> I'll let you know how it resolves.
>
> — <founder>, Stoop

(Sentence case, second person, no error codes. Fill in `<number>`, `<name>`, `<date>`.)

## Where things live

| Thing | Location |
| --- | --- |
| Refund action | `lib/actions/refunds.ts` (`refundOrder`) |
| Refund UI (Cancel & refund) | `app/dashboard/orders/orders-board.tsx` (OrderDetail) |
| State machine RPC | `mark_order_refunded` (migration `0025`/`0026`) |
| Webhook handlers | `lib/stripe/webhook-handlers.ts` |
| Refund/dispute events to enable | `charge.refunded`, `charge.refund.updated`, dispute events (Stripe webhook config) |
