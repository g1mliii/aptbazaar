# Launch checklist

> Phase 10.8. Everything to verify the day before going public. Distilled from the Production Privacy
> & Security Checklist and the MVP Release Gate in `IMPLEMENTATION_PLAN.md`. Walk it top to bottom;
> don't announce until every box is checked. Runbooks referenced here live in `docs/runbooks/`.

## Payments (Stripe)

- [ ] Stripe is in **live mode** for production (live keys in production env only).
- [ ] Platform never custodies funds — all transfers use `transfer_data.destination`.
- [ ] Refund/dispute webhook events are enabled: `charge.refunded`, `charge.refund.updated`, dispute
      events (Phase 6 manual step).
- [ ] Webhook signature verification is on; events persist to `stripe_events` before processing.
- [ ] Dispute alerts route to the founder email + Sentry.
- [ ] A full refund has been rehearsed end-to-end (`docs/runbooks/refund-dispute.md`).

## Email (Cloudflare Email Sending)

- [ ] Sender domain onboarded; sending in **live/production mode** (Phase 11.2).
- [ ] SPF, DKIM, DMARC DNS records in place; a test send shows `DKIM=pass`, `SPF=pass`, `DMARC=pass`.
- [ ] `CLOUDFLARE_EMAIL_FROM` = `orders@stoop.app`; can send to arbitrary recipients (not just
      verified destinations).
- [ ] Order-confirmation and drop emails exercised end-to-end to Gmail / Outlook / Apple Mail, not
      flagged as spam.
- [ ] Drop emails carry one-click unsubscribe + physical-address footer (CASL/CAN-SPAM); `/u/[token]`
      honors GET and POST (RFC 8058).

## Security headers and CSP

- [ ] CSP **enforced** (not report-only) in production; `script-src` excludes `unsafe-inline` /
      `unsafe-eval`.
- [ ] HTTPS enforced; HSTS set with a long max-age.
- [ ] `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`,
      `Permissions-Policy` denies camera/mic/geolocation.
- [ ] Headers verified against a **live production request**, not just CI.

## Abuse and rate limits

- [ ] Rate limits live on every anonymous-write route (order, subscribe, magic-link).
- [ ] Turnstile site + secret keys set in production (order + subscribe forms).
- [ ] Daily order caps and drop-email limits (per-store + platform-wide) active.

## Tenant isolation and privacy

- [ ] Every table has at least one RLS policy; service-role-only tables have no anon/auth policies.
- [ ] Cross-tenant integration tests pass.
- [ ] No unit numbers leak in any public API response (storefront or bazaar).
- [ ] `/privacy` and `/terms` are published and list every data category actually stored; signup
      links to both.
- [ ] `ADMIN_SHARED_SECRET` set in production (`wrangler secret put`); `/admin` is gated and
      `noindex`.

## Observability

- [ ] Sentry is in production (client + server); release tags wired.
- [ ] Sentry alert routing tested with a simulated production error
      (`docs/observability/sentry-alerts.md`).

## Backups and rollback

- [ ] Supabase PITR confirmed enabled; restore rehearsed once
      (`docs/runbooks/backup-restore.md`).
- [ ] Rollback runbook rehearsed: a deploy rolled back in under 10 minutes
      (`docs/runbooks/rollback.md`).

## Support

- [ ] `help@stoop.app` is set up and manned; canned responses ready
      (`docs/support/canned-responses.md`).

## Build gate

- [ ] `npm run verify` exits 0 on `main`.
- [ ] Lockfile committed; CI uses `npm ci`; dependency audit passes.

## Final kit pass (side-by-side with `ui_kits/` references)

Open each production surface next to its kit JSX and flag any drift before launch:

- [ ] Storefront `/s/[slug]` — `StoreHeader` + `ProductCard` + `CartDrawer` + `CheckoutForm` +
      `SubscribeForm`
- [ ] Tracking `/o/[token]` — `OrderTracking`
- [ ] Dashboard — Orders, Products, Money, QR, Subscribers, Settings (+ `Sidebar` / `Topbar`)
- [ ] Bazaar `/b/[slug]` — `bazaar/*`
- [ ] Voice cheat sheet honored in all chrome; no emoji; money/counts in mono + tabular; status as
      rubber stamps; wax seals only on ceremonial moments.

> Note: `/admin` and `/privacy` / `/terms` have **no kit reference** — they're built in the kit's
> spirit from `--ab-*` tokens. Eyeball them for token consistency (no raw hex, no inline px).

## Go / no-go

Don't announce broadly until the founder has watched **at least 20 real paid orders** complete
end-to-end (Phase 10.9). Soft-launch to the Phase 0 / 10.1 sellers and the waitlist first.
