-- Phase 6.5: subscriber drops. Additive only (expand-contract) — no column or type changes, so
-- database.types.ts is unaffected and gen-types is a no-op for this migration.
--
-- Two things:
--   (1) Single-opt-in backfill. The storefront consent checkbox IS the opt-in (decision: v1 single
--       opt-in), but subscribe() never stamped verified_at, and the drop-eligible partial index
--       (subscribers_store_active_drop_idx) filters on verified_at IS NOT NULL. Without this, zero
--       existing rows are drop-eligible. Stamp created_at as the verification time for the backlog;
--       new rows get verified_at = now() at capture going forward.
--   (2) Owner DELETE policy. The seller-side remove action runs under the seller's own JWT, so RLS
--       stays load-bearing (hard invariant 1) rather than reaching for the service role. Mirror of
--       the existing subscribers_owner_select. The unsubscribe path needs no new policy — it updates
--       by token through the service-role client.

update public.subscribers
set verified_at = created_at
where verified_at is null;

-- Ownership helper lives in the private schema since 0011 (public.is_store_owner was dropped).
create policy subscribers_owner_delete on public.subscribers
  for delete to authenticated using (private.is_store_owner(store_id));

grant delete on public.subscribers to authenticated;
