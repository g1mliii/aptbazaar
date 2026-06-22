# Cloudflare deployment

Phase 1 keeps the Pages `_headers` and `_redirects` files required by the
implementation plan, but full-stack Next.js route handlers need the OpenNext
Worker runtime on Cloudflare.

Use these commands:

```bash
npm run verify
npx opennextjs-cloudflare build
npx wrangler deploy --env preview
```

The preview Worker is `aptbazaar-preview`. Production deploys use:

```bash
npx wrangler deploy --env production
```

Supabase uses the current publishable/secret API key model. The project URL and
publishable key are configured as non-secret Wrangler vars. Add the server-only
secret key with:

```bash
npx wrangler secret put SUPABASE_SECRET_KEY --env preview
```

Cloudflare Email Service sends transactional mail through the `EMAIL` Worker
binding in `wrangler.jsonc`. Before test sends can work, onboard the sender
domain in Cloudflare Email Sending:

```bash
npx wrangler email sending enable stoop.app
npx wrangler email sending dns get stoop.app
```

The committed Wrangler vars use `orders@stoop.app` as the sender address. Change
`CLOUDFLARE_EMAIL_FROM` per environment if the onboarded sender changes.

`npm run build` intentionally runs `next build --webpack`. The default Next.js
16 build uses Turbopack, and the Phase 1 preview deploy hit an OpenNext runtime
chunk-load failure from the generated Turbopack server chunks.

Current compatibility note: automatic Sentry build instrumentation is not
wrapped in `next.config.ts`, and the automatic `instrumentation.ts` entrypoint
is intentionally absent, because the Cloudflare Worker failed while loading the
generated Next instrumentation hook during the Phase 1 preview deploy. Client
Sentry setup and the explicit server test route remain in place with release
tags from env vars.

## Phase 6 manual deploy steps

These ship with the Phase 6 code but must be done by hand against each environment.

1. **Apply migrations through `0031_place_order_idempotent_stock_replay.sql`** to the
   linked Supabase project, then regenerate types (`npm run supabase:gen-types`). The committed
   `lib/supabase/database.types.ts` was hand-edited to match `0028`; regen
   reconciles any drift. The migration adds the `refund_pending` / `refund_failed`
   `payment_status` values, the `transition_order_status` /
   `mark_pay_at_pickup_paid` RPCs, the inventory decrement in `place_order`, and
   the exactly-once stock-restore path. `0029` is a forward-only RPC compatibility
   migration for any environment that tested an earlier `0028` draft. `0030`
   re-emits `place_order` with deterministic product-lock ordering for projects
   that already applied `0028`. `0031` re-emits `place_order` for projects that
   already applied `0030`, preserving same-key idempotency replay after a duplicate
   submit waits behind finite-stock locks.

2. **Enable the refund events in Stripe.** The `refund_failed` path is dead until
   `charge.refund.updated` (and/or `refund.failed`, if enabled on the account) is
   turned on in the Stripe webhook config. Until then a failed refund leaves the
   order stuck in `refund_pending`. Add these event types to the webhook endpoint
   alongside the existing `charge.refunded`.

3. **`OrderStreamDO` Durable Object — wired (no manual step).** Live tracking (SSE)
   binds an `ORDER_STREAM` Durable Object (`worker/order-stream-do.ts`). Because the
   generated `.open-next/worker.js` can't be edited, `wrangler.jsonc` `main` points
   at a thin wrapper, `worker.mjs`, which re-exports the OpenNext default handler
   (and OpenNext's own DOs via `export *`) plus `OrderStreamDO`. The `cf:*` scripts
   run `opennextjs-cloudflare build` first, so `.open-next/worker.js` exists before
   wrangler bundles the wrapper. No extra step — `npm run cf:deploy` ships the DO.
   (The app still degrades gracefully if the DO is ever unavailable: the stream route
   returns 503 and the tracking page rides its 20s poll fallback.)
