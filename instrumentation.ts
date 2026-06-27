import * as Sentry from "@sentry/nextjs";

// Phase 9.7: load the server / edge Sentry init through Next's instrumentation hook so server spans
// and error capture initialize cleanly (the client SDK loads via instrumentation-client.ts). Without
// this, sentry.server.config / sentry.edge.config are never imported and server errors go uncaptured.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Surfaces errors thrown in React Server Components, route handlers, and server actions to Sentry.
export const onRequestError = Sentry.captureRequestError;
