# Scale audit — toward ~10k concurrent

A pass over the read/write hot paths with one question: what breaks, or gets expensive,
when 10,000 people hit Stoop at once? The short answer is **not much** — the app was built
cache- and RLS-aware from the start. This doc records what's already handled, the one change
made in this pass, and the levers left for a human to decide on.

## Already in place (no action needed)

| Concern | Where it's handled |
| --- | --- |
| Per-user HTML rebuilds on the storefront | `app/s/[slug]/page.tsx` is ISR (`revalidate = 30`) + `cache()`-deduped reads |
| `select *` on PII tables | None in production; CI `pii-guard` test enforces it |
| Over-fetching | Explicit non-PII column lists on every public read |
| N+1 on the bazaar | `get_building_product_highlights` RPC returns top-product + drops in one round-trip |
| One-row-at-a-time writes | None found; drop email fan-out batches via `Promise.allSettled` over `SEND_BATCH_SIZE` |
| Sequential awaits with no dependency | Already `Promise.all` (storefront reads, QR font loads, membership sync, admin metrics) |
| Long-lived connections | SSE is one Durable Object per order with a 20s poll fallback — no worker-per-connection leak |
| Hot indexes | Dedicated scale-index migrations `0012`, `0017`, `0027`, `0033` |
| Static asset caching | `/assets/*` → `Cache-Control: immutable, max-age=31536000` |
| Generated QR/PDF assets | Content-hash keyed in R2; re-download is a cheap read |

## Changed in this pass

### Cache open-building bazaar reads (`app/b/[publicSlug]/page.tsx`)

The building bazaar was `force-dynamic`, so **every** request hit Postgres (a member join + the
highlights RPC). For a viral *open* building that's the one real DB hot spot at scale.

The member roster and drops are already public, Zod-projected, PII-free data, so the read for
**open buildings only** now goes through `unstable_cache` (30s revalidate, tagged `bazaar:<id>`) —
the same freshness the storefront already accepts. **Invite-only buildings are untouched:** they
still read fresh on every request, so the cookie gate can never be bypassed by a cached payload,
and nothing behind an invite is ever cached. No RLS change.

Effect: a popular open bazaar drops from `O(requests)` Postgres round-trips to ~one per 30s window.

> Optional follow-up: call `revalidateTag(\`bazaar:<buildingId>\`)` from the membership/visibility
> mutation paths (`lib/actions/settings.ts`, `lib/actions/building.ts`) to make roster changes
> appear instantly instead of within 30s. Left out here to keep the change surgical.

## Follow-ups (second pass)

These started as recommendations and were implemented after review.

### Admin metrics aggregation moved to SQL — `lib/admin/load-metrics.ts` + migration `0040`

`loadAdminMetrics` used to pull **every paid order** into the Worker and sum/group in JS — memory and
latency growing linearly with lifetime order volume. Replaced with a `security definer` RPC
(`public.get_admin_metrics`, migration `0040`) that does the whole rollup in Postgres and returns one
bounded JSON document. The fee **rate** stays single-sourced in TypeScript (`PLATFORM_FEE_BPS` is
passed in as `p_fee_bps`); only the per-order rounding is mirrored in SQL, and `round(numeric)` is
half-away-from-zero — identical to `Math.round` for the non-negative totals paid orders carry. The
function is granted to `service_role` only; the JSON is Zod-validated at the loader boundary
(`parseAdminMetrics`).

> Apply migration `0040` and run the integration suite against the linked DB before trusting the
> dashboard numbers — the SQL math (GMV, per-order fees, top-N) is covered there, not in the unit
> suite. The unit test now pins the Zod boundary mapping only.

### Order tracking pauses its poll once SSE covers the order — `app/o/[token]/tracking.tsx`

The tracker ran a 20s poll **and** an `EventSource` simultaneously. The catch: seller order-status
actions publish to the stream, but **Stripe webhook payment/refund changes do not** — they surface
only through the poll. So the fix is conditional, not blanket:

- **Pay-at-pickup orders** (payment status never changes) — once SSE connects (`onopen`) the poll is
  pure redundant load, so it's paused; `onerror` resumes it. This is the bulk of trackers at scale.
- **Online orders** — keep the reconciliation poll running alongside SSE so Stripe-driven payment and
  refund transitions still land promptly. No behavior change for them.

> Fuller follow-up (not done): also publish payment/refund changes to the order stream from the Stripe
> webhook + refund paths. That would let online orders drop the poll too — but it touches the money
> path, so it's left as a deliberate next step.

### RLS tradeoff decisions

None. No change in this pass required relaxing, bypassing, or restructuring an RLS policy. The bazaar
cache covers only already-public data; the admin RPC is `security definer` + `service_role`-only and
reads no PII (`store_id`, `total_cents` only). Tenant isolation in SQL is unchanged.

## How this was verified

`npm run verify` (typecheck + lint + unit tests + build + image-processor verify) — see the PR body
for the result. The bazaar change is behavior-preserving for invite buildings and adds a bounded
30s cache window for open ones.
