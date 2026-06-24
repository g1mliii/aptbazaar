// Phase 2.9: store/building slug generation.
// Output is always url-safe, <= 40 chars, never a reserved route word, and unique
// against a caller-supplied availability check.

const MAX_LENGTH = 40;

/** The shape every public slug (store + building bazaar) must match: lowercase alnum/hyphen, 1–40. */
export const PUBLIC_SLUG_RE = /^[a-z0-9-]{1,40}$/;

// Words that collide with our own routes, plus brand/authority terms we never want a seller to
// claim as a storefront URL (impersonation). `_next` can never be produced by slugify
// (underscores are stripped) but is listed for completeness.
//
// NOTE: keep this in sync with the reserved-word guard inside create_store_quickstart
// (latest definition in supabase/migrations/0018_store_name_abuse_and_rls_initplan.sql) — the
// RPC re-checks at insert time.
const RESERVED = new Set([
  "admin",
  "api",
  "app",
  "b",
  "s",
  "o",
  "dashboard",
  "settings",
  "health",
  "static",
  "_next",
  "auth",
  "login",
  "signup",
  // Brand / authority impersonation.
  "stoop",
  "support",
  "help",
  "official",
  "billing",
  "payments",
  "team",
  "staff",
  "about",
  "contact",
  "terms",
  "privacy"
]);

const FALLBACK = "stoop";

/** Pure transform: lowercase, hyphenate, strip non-alphanumerics, trim, truncate to 40. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, "");
  return base.length > 0 ? base : FALLBACK;
}

function withSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  const room = MAX_LENGTH - suffix.length;
  let truncated = base.slice(0, room).replace(/-+$/g, "");
  if (truncated.length === 0) {
    truncated = FALLBACK.slice(0, room);
  }
  return `${truncated}${suffix}`;
}

type AvailabilityCheck = (slug: string) => boolean | Promise<boolean>;

/**
 * Returns a unique slug for `desired`. Reserved words and taken slugs retry with a
 * numeric suffix (`-2`, `-3`, …). `isTaken` returns true when a slug is already in use.
 */
export async function generateUniqueSlug(
  desired: string,
  isTaken: AvailabilityCheck
): Promise<string> {
  const base = slugify(desired);
  let candidate = base;
  let n = 2;

  while (RESERVED.has(candidate) || (await isTaken(candidate))) {
    candidate = withSuffix(base, n);
    n += 1;
  }

  return candidate;
}
