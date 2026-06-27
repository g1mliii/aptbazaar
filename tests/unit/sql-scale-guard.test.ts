import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readMigration(name: string): string {
  return readFileSync(`supabase/migrations/${name}`, "utf8");
}

function maybeReadMigration(name: string): string | null {
  const path = `supabase/migrations/${name}`;
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

describe("SQL scale guards", () => {
  it("keeps cost snapshots off exact per-table count scans", () => {
    const sql = readMigration("0037_cost_snapshot.sql");

    expect(sql).toContain("pg_stat_user_tables");
    expect(sql).toContain("orders_paid_cost_snapshot_idx");
    expect(sql).not.toMatch(/jsonb_build_object[\s\S]+select count\(\*\) from public\./i);
  });

  it("does not hold the store row lock across the whole place_order transaction", () => {
    const sql = maybeReadMigration("0039_order_caps_and_free.sql");
    if (!sql) return;

    expect(sql).not.toMatch(/from public\.stores st[\s\S]{0,240}for update of st/i);
    expect(sql).toMatch(/update public\.stores[\s\S]+orders_per_day_limit is null/i);
    expect(sql).toMatch(/if not found then\s+raise exception 'capacity_reached'/i);
  });

  it("grants anon access to the storefront capacity columns", () => {
    const sql = maybeReadMigration("0039_order_caps_and_free.sql");
    if (!sql) return;

    expect(sql).toMatch(
      /grant select\s*\(\s*orders_per_day_limit,\s*orders_today,\s*orders_today_date\s*\)\s*on public\.stores to anon/i
    );
  });
});
