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
