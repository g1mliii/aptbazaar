# Runbook: backup and restore

> Phase 10.7. Confirm Supabase point-in-time recovery (PITR) is on, and rehearse a restore to a
> scratch project so the steps are known before they're needed in anger.

## A. Confirm backups are enabled (do this now)

1. Supabase dashboard → the linked project → Database → **Backups**.
2. Confirm **Point-in-Time Recovery** is enabled. PITR requires a paid plan; verify the plan covers
   it. Note the **retention window** (how far back you can restore).
3. Confirm daily logical backups are also listed.
4. Record the project ref (`supabase/.temp/project-ref`) and the PITR retention window in the
   founder notes.

> If PITR is **not** enabled, enabling it is the highest-priority launch-blocker in this runbook —
> a forward-only schema policy means restore-from-backup is the only recovery for data loss.

## B. Rehearse a restore (do this before launch, once)

The goal is to prove a restore actually works and to time it — not to touch production.

1. Create a **scratch Supabase project** (separate from preview and production).
2. From the production project's Backups page, choose a recent point in time and **restore into the
   scratch project** (or restore a downloaded logical backup into it). Follow Supabase's restore
   flow; do **not** restore over production.
3. Time how long the restore takes end-to-end. Record it.
4. Verify the restored data:
   - Row counts on a few core tables (`stores`, `products`, `orders`) look sane.
   - A spot-checked order has its `order_items` and tracking token.
   - RLS policies are present (a restore includes schema + policies).
5. Tear down the scratch project when done so it doesn't accrue cost or drift.

## C. If you ever need a real restore

1. **Stop writes if you can** — put the app in a maintenance posture (roll the Worker to a holding
   page, or disable the affected flow) so you're not restoring a moving target.
2. Decide the **target point in time** (just before the data loss).
3. Restore. For a catastrophic case, restore into a **new** project first, validate it (section B-4),
   then cut over `NEXT_PUBLIC_SUPABASE_URL` + keys — rather than restoring in place blind.
4. After cutover: regenerate types if schema moved (`npm run supabase:gen-types`), redeploy the app
   pointed at the restored project, and verify `/api/health`.
5. Reconcile Stripe: replay any webhook events that landed after the restore point
   (`docs/runbooks/rollback.md` section B) so order/payment state matches Stripe.

## Notes

- Restores are **forward** operations too — you never "un-restore." Validate in a scratch/new project
  before pointing production at restored data.
- Keep the rehearsal recent: re-run section B if the schema changes materially.
