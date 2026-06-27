import * as Sentry from "@sentry/nextjs";

// Phase 9.7: one tagged entry point for the failures our Sentry alerts watch. The `area` tag gives
// each alert a stable filter independent of the message text, so dashboard rules don't break when
// copy changes. No-ops cleanly when Sentry is disabled (no DSN).

export type FailureArea =
  | "stripe-webhook"
  | "order-placement"
  | "image-upload"
  | "rls-violation";

export function captureFailure(
  area: FailureArea,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  Sentry.captureException(error, { tags: { area }, extra });
}
