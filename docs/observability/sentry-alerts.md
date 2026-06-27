# Sentry alerts (Phase 9.7)

These five alert rules are defined in the Sentry dashboard (Alerts → Create Alert). They are not
infrastructure-as-code; this file is the source of truth for re-creating them. Server/edge errors
are captured via `instrumentation.ts` (`register` + `onRequestError`); the targeted failures below
are tagged through `captureFailure(area, …)` in `lib/observability/capture.ts`, so each alert filters
on a stable `area` tag rather than message text.

| # | Alert | Condition | Filter |
|---|-------|-----------|--------|
| 1 | API error rate | Error events > 1% of total over 5 min | environment:production |
| 2 | Stripe webhook failures | `area:stripe-webhook` events > 0 in 10 min | tag `area = stripe-webhook` |
| 3 | Order placement failures | `area:order-placement` events > 5 in 5 min | tag `area = order-placement` |
| 4 | Image upload failures | `area:image-upload` events > 10% of upload attempts in 10 min | tag `area = image-upload` |
| 5 | RLS violation canary | any `area:rls-violation` event (should be impossible) | tag `area = rls-violation` |

Notes:
- Alert 5 is a canary — RLS denies cross-tenant access in SQL, so a tagged `rls-violation` event
  should never fire. If it does, treat it as a Sev-1.
- Alert 4's denominator (upload attempts) isn't in Sentry; approximate with a fixed count threshold
  (e.g. > 10 failures in 10 min) until upload volume is instrumented as a metric.
- All alerts should notify the founder channel/email. Tune thresholds after the first week of real
  traffic to avoid noise.
