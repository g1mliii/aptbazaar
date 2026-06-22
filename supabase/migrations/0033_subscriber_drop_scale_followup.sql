-- Phase 6.5 follow-up for environments where 0032_subscriber_drops.sql was already applied
-- manually before the scale/index corrections landed.
--
-- This migration is intentionally forward-only and idempotent:
--   (1) If the earlier 0032 backfilled verified_at for rows without email consent, undo that
--       eligibility stamp. New subscriber captures require consent_email=true at the schema/action
--       layer, so this only corrects legacy/manual-apply state.
--   (2) Add covering indexes for the current Subscribers roster and drop-send hot paths. The
--       existing non-covering indexes remain in place for compatibility; these cover the explicit
--       projections used by Phase 6.5 without introducing any public PII surface.

update public.subscribers
set verified_at = null
where consent_email is false
  and unsubscribed_at is null
  and verified_at is not null;

create index if not exists subscribers_store_roster_cover_idx
  on public.subscribers (store_id, created_at desc)
  include (id, email, consent_email, verified_at, unsubscribed_at);

create index if not exists subscribers_store_active_drop_cover_idx
  on public.subscribers (store_id, created_at desc)
  include (email, unsubscribe_token)
  where verified_at is not null and unsubscribed_at is null;
