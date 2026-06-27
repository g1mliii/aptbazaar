import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { walkSource } from "./source-walk";

// Phase 9.10: keep secrets out of browser-reachable code (hard invariant 8 — the service role key
// never reaches the browser). Three checks:
//   1. No real secret-shaped literal is committed anywhere (sk_live_…, sk_test_…, whsec_…).
//   2. No client component ("use client") references a server-only secret env var or the
//      service_role role.
//   3. No NEXT_PUBLIC_* env var is named like a secret (publishable vars only).
// Server-only files (lib/supabase/secret.ts, lib/stripe/client.ts, worker/*) legitimately read the
// secret env vars — those are not flagged because they carry no "use client" directive.

const files = [...walkSource("app"), ...walkSource("lib"), ...walkSource("worker")];

const SECRET_LITERAL = /\b(sk_live|sk_test|rk_live|whsec)_[A-Za-z0-9]{8,}/;
const NEXT_PUBLIC_SECRET = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE_KEY|WEBHOOK)/;
const CLIENT_SECRET_REF =
  /(SUPABASE_SECRET_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|service_role)/;

const isClientFile = (source: string) =>
  /^\s*["']use client["']/m.test(source);

describe("secrets guard", () => {
  it("commits no secret-shaped literal", () => {
    const offenders = files
      .filter((file) => SECRET_LITERAL.test(file.source))
      .map((file) => file.path);
    expect(offenders, `secret literal in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("never names a NEXT_PUBLIC_ var like a secret", () => {
    const offenders = files
      .filter((file) => NEXT_PUBLIC_SECRET.test(file.source))
      .map((file) => file.path);
    expect(offenders, `NEXT_PUBLIC secret-like var in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps server-only secrets out of client components", () => {
    const offenders = files
      .filter((file) => isClientFile(file.source) && CLIENT_SECRET_REF.test(file.source))
      .map((file) => file.path);
    expect(offenders, `secret reference in client file: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps the server-only guard on the service-role client", () => {
    const source = readFileSync(join(process.cwd(), "lib/supabase/secret.ts"), "utf8");
    expect(source).toMatch(/import\s+["']server-only["']/);
  });
});
