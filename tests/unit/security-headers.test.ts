import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, securityHeaders } from "@/lib/security/headers";

const headerValue = (key: string) =>
  securityHeaders.find((header) => header.key === key)?.value;

// Read a header value out of the static public/_headers (the Cloudflare Pages path). The block we
// care about is the catch-all `/*` route; its directives are indented one or more spaces.
function staticHeader(key: string): string | undefined {
  const raw = readFileSync(join(process.cwd(), "public/_headers"), "utf8");
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim();
}

describe("security headers", () => {
  it("sets the baseline headers", () => {
    expect(securityHeaders).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" }
      ])
    );
  });

  it("enforces CSP (Phase 9.2 — no longer report-only)", () => {
    expect(
      securityHeaders.some((header) => header.key === "Content-Security-Policy-Report-Only")
    ).toBe(false);
    expect(headerValue("Content-Security-Policy")).toBe(contentSecurityPolicy);
  });

  it("locks down the core CSP directives", () => {
    expect(contentSecurityPolicy).toContain("default-src 'self'");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
  });

  it("allows Stripe and Turnstile where they are needed", () => {
    expect(contentSecurityPolicy).toContain("https://js.stripe.com");
    expect(contentSecurityPolicy).toContain("https://challenges.cloudflare.com");
    expect(contentSecurityPolicy).toContain("https://checkout.stripe.com");
  });

  it("allows inline scripts (App Router inline bootstrap needs it; no nonce w/ static render)", () => {
    expect(contentSecurityPolicy).toContain(
      "script-src 'self' 'unsafe-inline' https://js.stripe.com"
    );
    // 'unsafe-eval' must stay out — we never need runtime eval.
    expect(contentSecurityPolicy).not.toContain("'unsafe-eval'");
  });

  it("narrows img-src to the upload + storage hosts", () => {
    expect(contentSecurityPolicy).toContain("img-src 'self' data: blob: https://*.r2.dev");
    expect(contentSecurityPolicy).not.toMatch(/img-src[^;]*\shttps:(\s|;|$)/);
  });

  it("allows the custom upload domain images are served from (next.config remotePatterns)", () => {
    expect(contentSecurityPolicy).toContain("https://uploads.stoop.app");
  });

  it("sends HSTS", () => {
    expect(headerValue("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(headerValue("Strict-Transport-Security")).toContain("includeSubDomains");
  });

  // The CSP + HSTS are hand-maintained in two places: the runtime headers (next.config) and the
  // static public/_headers (Cloudflare Pages). They must not drift — a host allowed in one but not
  // the other silently breaks images/connectivity on whichever path serves the request.
  it("keeps public/_headers in sync with the source-of-truth headers", () => {
    expect(staticHeader("Content-Security-Policy")).toBe(contentSecurityPolicy);
    expect(staticHeader("Strict-Transport-Security")).toBe(
      headerValue("Strict-Transport-Security")
    );
  });
});
