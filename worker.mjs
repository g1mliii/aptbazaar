// Worker entry (Phase 6.0c). OpenNext generates `.open-next/worker.js` and re-exports its own
// Durable Objects from it, but that file is regenerated on every build and can't be edited. To add
// our own Durable Object we point wrangler's `main` at this thin wrapper: it forwards the OpenNext
// default fetch handler (and any DO classes OpenNext exports) untouched, and adds `OrderStreamDO`.
//
// Resolution happens at `wrangler deploy` / `opennextjs-cloudflare build|preview|deploy` time, when
// `.open-next/worker.js` already exists. This file is intentionally a `.mjs` so it stays out of the
// app's TypeScript graph (it imports a build artifact); see eslint.config.mjs ignore + tsconfig.
//
// IMPORTANT: run the OpenNext build before any wrangler command so `.open-next/worker.js` exists
// (the `cf:*` npm scripts already do `opennextjs-cloudflare build` first).

// Forward everything OpenNext exports (its internal Durable Objects, etc.)…
export * from "./.open-next/worker.js";
// …and add our live-order-tracking Durable Object.
export { OrderStreamDO } from "./worker/order-stream-do.ts";

// The OpenNext default export carries the `fetch` handler (which `export *` does not re-export). We
// spread it and bolt on `scheduled` (Phase 7.6) so the weekly cron reclaims orphaned QR cache
// objects without touching the request path.
import openNextHandler from "./.open-next/worker.js";
import { sweepQrAssets } from "./worker/qr-sweep.ts";

export default {
  ...openNextHandler,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sweepQrAssets(env));
  }
};
