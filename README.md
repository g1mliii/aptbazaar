# aptbazaar

> QR-storefront platform for local sellers. Create a shop, add products, generate a QR code, and take orders + payments — without DMs.

aptbazaar lets home bakers, candle and craft makers, meal-prep cooks, tutors, and campus/condo creators stand up a real checkout page in minutes. Each seller's storefront is useful on its own. As more sellers in the same building opt in, that building's local bazaar lights up automatically.

## Stack

- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind CSS
- **Backend:** Supabase (Postgres + Auth + Storage + RLS)
- **Hosting:** Cloudflare Pages
- **Payments:** Stripe Connect Express
- **Email:** Cloudflare Email Service
- **Observability:** Sentry
- **Validation:** Zod
- **Testing:** Vitest + Playwright

## Getting started

Prerequisites:

- Node.js — version is pinned in [`.nvmrc`](./.nvmrc)
- A Supabase project (or local instance via the Supabase CLI)
- A Stripe account with Connect enabled (Express accounts)
- Cloudflare Email Sending enabled for the sender domain
- A Sentry project (optional during early development)

Setup:

```bash
npm install

# Copy the env template and fill in your local values
cp .env.example .env.local

# Run the dev server
npm run dev
```

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit + component tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run verify` | typecheck + lint + test + build |

## Project layout

```
aptbazaar/
  app/                      # Next.js App Router routes
    (public)/               # Storefront, order tracking, bazaar
    dashboard/              # Seller dashboard
    api/                    # Webhook routes (Stripe, etc.)
  lib/
    schemas/                # Shared Zod schemas
    supabase/               # Supabase client + helpers
    stripe/                 # Stripe Connect helpers
    addresses/              # Normalization, slug generation, tokens
  supabase/
    migrations/             # SQL migrations with RLS policies
  tests/
    unit/
    integration/
    e2e/
  docs/
    runbooks/               # Refund, rollback, backup-restore
```

## Deployment

Production deploys to Cloudflare Pages on push to `main`. Preview deploys are created per PR. Secrets live in Cloudflare environment variables and Supabase Vault — never in the repo.

## Security

See [SECURITY.md](./SECURITY.md) for vulnerability disclosure and reporting.

## License

Proprietary. See [LICENSE](./LICENSE). All rights reserved.
