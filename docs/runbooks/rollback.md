# Runbook: rollback

> Phase 10.3. How to roll back a bad deploy and recover dropped Stripe events. **Schema is
> roll-forward only** — see the schema section below before you reach for `psql`. Target: a founder
> can roll back a deploy from this doc in under 10 minutes.

## What can and can't be rolled back

| Layer | Reversible? | How |
| --- | --- | --- |
| App code (Worker deploy) | Yes | Redeploy the previous version (below) |
| Stripe events during a bad window | Yes | Replay from the durable inbox (below) |
| Database schema | **No — roll forward** | New corrective migration through CI (below) |

## A. Roll back the app (Cloudflare Worker / OpenNext)

The app ships as an OpenNext Worker (`npm run cf:deploy` → `opennextjs-cloudflare build` +
`wrangler deploy`). See `docs/deployment/cloudflare.md`. Production is `--env production`, preview is
`aptbazaar-preview`.

**Fastest path — Cloudflare dashboard:**

1. Cloudflare dashboard → Workers & Pages → the production Worker → **Deployments**.
2. Find the last known-good deployment (the one before the bad one).
3. **Rollback** to it. This re-promotes that version's bundle immediately — no rebuild.

**CLI path — redeploy a known-good commit:**

```bash
git checkout <last-good-sha>
npm run verify          # confirm the known-good tree still passes
npx opennextjs-cloudflare build
npx wrangler deploy --env production
```

After rollback:

- Hit `/api/health` and confirm it's green (Supabase + email status).
- Load the production storefront and dashboard to confirm they render.
- Return to `main` locally (`git checkout main`) so you don't keep working on the detached commit.

## B. Replay Stripe events dropped during the bad window

Every webhook is verified and persisted to the durable `stripe_events` inbox **before** processing,
and processing is deduped by `stripe_event_id` — so **replaying an already-processed event is a
no-op**. This makes replay safe to do liberally.

1. Identify the window the bad deploy was live (deploy timestamp → rollback timestamp).
2. Stripe dashboard → Developers → Webhooks → the endpoint → **Events**. Filter to the window.
3. For events that show delivery failures (non-2xx) during the window, click **Resend**. Order
   confirmations, payment confirmations, and refund transitions all reconcile on resend.
4. Spot-check a few affected orders in `/dashboard/orders` to confirm they reached the right state
   (e.g. `paid`, `refunded`).

If many events failed, resend `payment_intent.succeeded` / `checkout.session.completed` first (money
state), then `charge.refunded` and status events.

## C. Schema: roll-forward only

**Do not** run `DROP COLUMN`, `DROP TABLE`, or `ALTER TYPE` against production to "undo" a migration.
Migrations are forward-only and additive-only (`docs/migrations.md`). A bad schema change is fixed by
writing a **new corrective migration** that:

1. Expands/corrects additively (never drops a column a running deploy still reads).
2. Goes through CI and a canary apply, exactly like any other migration.
3. Annotates any eventual destructive contract step with `-- expand-contract: <migration>`.

This is deliberate: a running Worker must never see a column it expects suddenly gone. If a migration
caused an outage, roll back the **app** (section A) to a version that doesn't depend on the new shape,
then roll the schema *forward* with a fix. Never `psql` a `DROP` against production at 2 a.m.

## D. After any rollback

- Note what happened, the window, and the fix in the incident log / founder notes.
- Confirm Sentry is quiet (no new error spike).
- Open a follow-up to land the real fix on `main` and redeploy forward.
