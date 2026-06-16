import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { generateUniqueSlug, slugify } from "@/lib/utils/slug";

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const RESERVED = [
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
  "auth",
  "login",
  "signup"
];

const neverTaken = () => false;

describe("slugify", () => {
  it("always returns a value matching the slug shape", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(slugify(input)).toMatch(SLUG_RE);
      })
    );
  });
});

describe("generateUniqueSlug", () => {
  it("output always matches the slug shape", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (input) => {
        const slug = await generateUniqueSlug(input, neverTaken);
        expect(slug).toMatch(SLUG_RE);
      })
    );
  });

  it("never returns a reserved word", async () => {
    for (const word of RESERVED) {
      const slug = await generateUniqueSlug(word, neverTaken);
      expect(RESERVED).not.toContain(slug);
      expect(slug).toMatch(SLUG_RE);
    }
  });

  it("retries with a numeric suffix when the slug is taken", async () => {
    const taken = new Set(["maple-bakery", "maple-bakery-2", "maple-bakery-3"]);
    const slug = await generateUniqueSlug("Maple Bakery", (s) => taken.has(s));
    expect(slug).toBe("maple-bakery-4");
  });

  it("keeps suffixed slugs within 40 chars", async () => {
    const long = "a".repeat(80);
    const taken = new Set([slugify(long)]);
    const slug = await generateUniqueSlug(long, (s) => taken.has(s));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug).toMatch(SLUG_RE);
  });
});
