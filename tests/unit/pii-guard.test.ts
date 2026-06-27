import { describe, expect, it } from "vitest";

import { walkSource } from "./source-walk";

// Phase 9.5: enforce hard invariant 6 — no `select *` against PII tables. The Supabase client
// never needs a wildcard select on these tables; every read must list explicit columns so a new
// PII column can't silently leak into an API response. Comments that merely cite the rule are fine;
// we only ban an actual wildcard select bound to a PII table.

const PII_TABLES = ["sellers", "subscribers", "orders", "connected_accounts"];

// `.from("orders")...select("*")` — wildcard select on a supabase-js builder for a PII table.
const supabaseWildcard = (table: string) =>
  new RegExp(
    `\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)[\\s\\S]{0,400}?\\.select\\(\\s*["'\`]\\*`,
    "i"
  );

// `select * from orders` — raw SQL wildcard against a PII table (e.g. in an RPC string).
const sqlWildcard = (table: string) =>
  new RegExp(`select\\s+\\*\\s+from\\s+["'\`]?(public\\.)?${table}\\b`, "i");

describe("PII select* guard", () => {
  const files = [...walkSource("app"), ...walkSource("lib")];

  it("walks a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const table of PII_TABLES) {
    it(`has no wildcard select against ${table}`, () => {
      const builder = supabaseWildcard(table);
      const sql = sqlWildcard(table);
      const offenders = files
        .filter((file) => builder.test(file.source) || sql.test(file.source))
        .map((file) => file.path);
      expect(offenders, `wildcard select on ${table} in: ${offenders.join(", ")}`).toEqual([]);
    });
  }
});
