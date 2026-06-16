-- Code-review follow-up to 0002 + 0004. Idempotent: safe on a fresh DB (where 0002/0004 already
-- carry the fixed forms) and on a project where the original 0002/0004 were already applied.

-- 0002 fix: anon may only insert an order in a safe initial state. Without this, an anon
-- customer could self-declare payment_status = 'paid' (or advance order_status), since the
-- original WITH CHECK only verified the store was active. Payment state belongs to the Stripe
-- webhook (hard invariant 5); order_status is seller-driven.
drop policy if exists orders_anon_insert on public.orders;
create policy orders_anon_insert on public.orders
  for insert to anon with check (
    is_store_active(store_id)
    and order_status = 'new'
    and payment_status in ('unpaid', 'pay_at_pickup')
    and checkout_retry_count = 0
  );

-- 0004 fix: anon must not read normalized_key — it embeds the exact street line, which
-- buildingPublicSchema deliberately omits from the public projection.
revoke select (normalized_key) on public.buildings from anon;
