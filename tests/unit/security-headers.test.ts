import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicyReportOnly,
  securityHeaders
} from "@/lib/security/headers";

describe("security headers", () => {
  it("sets the Phase 1 baseline headers", () => {
    expect(securityHeaders).toEqual(
      expect.arrayContaining([
        {
          key: "X-Content-Type-Options",
          value: "nosniff"
        },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin"
        },
        {
          key: "X-Frame-Options",
          value: "DENY"
        }
      ])
    );
  });

  it("keeps CSP in report-only mode for Phase 1", () => {
    expect(contentSecurityPolicyReportOnly).toContain("default-src 'self'");
    expect(contentSecurityPolicyReportOnly).toContain("frame-ancestors 'none'");
    expect(
      securityHeaders.some((header) => header.key === "Content-Security-Policy")
    ).toBe(false);
  });
});
