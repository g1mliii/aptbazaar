-- Free / giveaway orders: a seller can list an item at $0 (a home baker giving away extras to the
-- building). An all-$0 cart can't go through Stripe (it rejects a zero-amount charge), so it needs a
-- distinct payment mode that skips checkout entirely and settles on placement. This value must be
-- committed in its own migration before place_order (rewritten in 0039) can reference it — a new enum
-- value isn't usable inside the same transaction that adds it.

alter type public.payment_mode add value if not exists 'free';
