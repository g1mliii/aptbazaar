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

## Recommendations (not implemented — your call)

### 1. Admin metrics fetch is unbounded — `lib/admin/load-metrics.ts`

`loadAdminMetrics` pulls **every paid order** (`orders.select("store_id, total_cents").eq("payment_status","paid")`)
into the Worker and sums in JS. Correct today, but memory and latency grow linearly with lifetime
order volume — eventually it can OOM the founder dashboard.

- **Fix:** move the aggregation into a `security definer` SQL function (`SUM(total_cents)`,
  `GROUP BY store_id`) and call it via `.rpc()`. Migration → (no new table, so no new RLS policy,
  but keep the function `security definer` + `search_path` locked like the other RPCs) → swap the
  loader.
- **Risk:** low. Single-founder page, not on the 10k-concurrent path, so it's a "before it bites"
  fix rather than urgent.

### 2. Order tracking polls even while SSE is healthy — `app/o/[token]/tracking.tsx`

The tracker runs a 20s `setInterval` poll **and** an `EventSource` at the same time. While the SSE
connection is open the poll is redundant load on `/api/track/[token]`. At 10k concurrent trackers
that's a meaningful chunk of avoidable requests.

- **Fix:** pause the interval while the `EventSource` is open (`onopen` → clear, `onerror` →
  resume), keeping the visibility-change refetch. Stripe-driven payment/refund changes still need a
  reconciliation poll, so don't drop it entirely — just gate it on SSE health.
- **Risk:** low–medium. Touches live-update behavior; verify payment-status transitions still land
  promptly before shipping.

### 3. RLS tradeoff decisions

None. No optimization in this pass required relaxing, bypassing, or restructuring an RLS policy.
The bazaar cache covers only already-public data and leaves tenant isolation in SQL exactly as-is.

## How this was verified

`npm run verify` (typecheck + lint + unit tests + build + image-processor verify) — see the PR body
for the result. The bazaar change is behavior-preserving for invite buildings and adds a bounded
30s cache window for open ones.
