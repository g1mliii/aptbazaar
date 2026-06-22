import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/utils/csv";

// Phase 6.5: the subscribers CSV export. RFC-4180 quoting — a field is quoted only when it contains
// a comma, double-quote, or newline, and interior quotes are doubled.

type Row = { email: string; joined: string; status: string };

const cols = [
  { header: "email", value: (r: Row) => r.email },
  { header: "joined", value: (r: Row) => r.joined },
  { header: "status", value: (r: Row) => r.status }
];

describe("toCsv", () => {
  it("writes a header row and CRLF line endings", () => {
    const csv = toCsv(
      [{ email: "a@x.com", joined: "Mar 1, 2026", status: "active" }],
      cols
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("email,joined,status");
    // "Mar 1, 2026" contains a comma → quoted.
    expect(lines[1]).toBe('a@x.com,"Mar 1, 2026",active');
  });

  it("quotes and doubles interior quotes", () => {
    const csv = toCsv(
      [{ email: 'weird"name@x.com', joined: "Jan 2", status: "active" }],
      cols
    );
    expect(csv).toContain('"weird""name@x.com"');
  });

  it("quotes fields containing newlines", () => {
    const csv = toCsv(
      [{ email: "a@x.com", joined: "line1\nline2", status: "active" }],
      cols
    );
    expect(csv).toContain('"line1\nline2"');
  });

  it("leaves plain fields unquoted", () => {
    const csv = toCsv(
      [{ email: "plain@x.com", joined: "Jan 2026", status: "active" }],
      cols
    );
    expect(csv).toContain("plain@x.com,Jan 2026,active");
  });
});
