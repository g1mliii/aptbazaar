# Database migration policy

Supabase migrations are **forward-only**. There is no `down` migration and no rollback — a
mistake is corrected by rolling *forward* with a new corrective migration. Treat every
migration as if it will run against production data the moment it merges.

## Additive-only / expand–contract

Every schema change is **additive**. Reshaping a column or table happens across multiple
deploys using the expand–contract pattern, never in one destructive step:

1. **Expand** — add the new column/table/enum value. Keep the old one.
2. **Backfill** — populate the new shape from the old (a data migration or background job).
3. **Switch reads/writes** — ship app code that uses the new shape.
4. **Contract** — only in a *later* migration, after the new shape is proven in production,
   drop the old column/table.

This guarantees a running deploy never sees a column it expects suddenly gone.

## Hard rules

- **No `DROP COLUMN`, `DROP TABLE`, `ALTER TYPE ... USING`, or `RENAME`** in the same
  migration that switches reads to a new shape. Those belong in a later contract migration.
- A destructive statement must be annotated with the migration it contracts, e.g.
  `-- expand-contract: 0007_add_payout_currency.sql`, so the history is auditable.
- **RLS lives with the table.** The migration that creates a table also enables RLS and
  defines its policies. No table reaches `main` without at least one policy
  (hard invariant 1). `service_role` gets explicit table grants in the same migration.
- **Deny by default.** Grant the narrowest privilege each role needs; never `grant all` to
  `anon`/`authenticated`.

## Naming

Numeric prefix, kebab description: `000N_short_description.sql`. `0001_phase_1_noop.sql` is
the Phase 1 tooling proof; Phase 2 schema starts at `0002_initial.sql`.

## CI guard (Phase 9)

A CI grep guard (Phase 9.x) will block `DROP COLUMN` / `DROP TABLE` / `ALTER TYPE` that
lack an `-- expand-contract: <previous-migration>` comment. It is **not** wired yet — this
doc is the policy it will enforce.

## Applying migrations

- **Local (throwaway):** `supabase start` applies every migration to a fresh local DB;
  `supabase db reset` re-applies from scratch. Used for fast iteration and the RLS
  integration suite.
- **Live (linked project):** `supabase db push` (needs `SUPABASE_DB_PASSWORD` and an account
  with privileges on the linked project ref in `supabase/.temp/project-ref`).
- After any schema change, regenerate types: `npm run supabase:gen-types > lib/supabase/database.types.ts`.
