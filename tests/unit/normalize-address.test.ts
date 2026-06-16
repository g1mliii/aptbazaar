import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizeAddress } from "@/lib/utils/normalize-address";

const streetName = fc.constantFrom(
  "main st",
  "king street",
  "queen ave",
  "oak road",
  "elm blvd"
);
const civic = fc.integer({ min: 1, max: 9999 });
const postal = fc.constantFrom("K1A 0B1", "m5v 2t6", "V6B1A1", "h2x 1y4");
const unit = fc.constantFrom("4", "4b", "12", "200", "a1", "ph2");

function withUnit(base: string, u: string): string[] {
  return [
    `${base}, Apt ${u}`,
    `${base} Apartment ${u}`,
    `${base} Unit ${u}`,
    `${base} Suite ${u}`,
    `${base} #${u}`,
    `#${u} ${base}`,
    `${u}-${base}`
  ];
}

describe("normalizeAddress", () => {
  it("collapses every unit variant to the same key as the unitless address", () => {
    fc.assert(
      fc.property(civic, streetName, postal, unit, (n, name, code, u) => {
        const base = `${n} ${name}`;
        const expected = normalizeAddress({ street: base, postalCode: code });
        for (const variant of withUnit(base, u)) {
          expect(normalizeAddress({ street: variant, postalCode: code })).toBe(expected);
        }
      })
    );
  });

  it("is stable across casing and whitespace", () => {
    fc.assert(
      fc.property(civic, streetName, postal, (n, name, code) => {
        const clean = normalizeAddress({ street: `${n} ${name}`, postalCode: code });
        const messy = normalizeAddress({
          street: `  ${n}   ${name.toUpperCase()}  `,
          postalCode: ` ${code.toLowerCase()} `
        });
        expect(messy).toBe(clean);
      })
    );
  });

  it("never leaks the unit token into the output", () => {
    fc.assert(
      fc.property(civic, streetName, postal, (n, name, code) => {
        const key = normalizeAddress({
          street: `${n} ${name}, Apt qq7zz`,
          postalCode: code
        });
        expect(key).not.toContain("qq7zz");
      })
    );
  });

  it("produces the documented `street|POSTAL` shape", () => {
    expect(normalizeAddress({ street: "345 Main St, Unit 12", postalCode: "k1a 0b1" })).toBe(
      "345 main st|K1A0B1"
    );
  });

  it("strips bare comma-separated trailing units (no designator word)", () => {
    const base = normalizeAddress({ street: "345 Main St", postalCode: "K1A 0B1" });
    for (const variant of ["345 Main St, 12", "345 Main St, #12", "345 Main St, 4b"]) {
      expect(normalizeAddress({ street: variant, postalCode: "K1A 0B1" })).toBe(base);
    }
    // Two bare-unit variants of the same building collapse together.
    expect(normalizeAddress({ street: "345 Main St, 12", postalCode: "K1A 0B1" })).toBe(
      normalizeAddress({ street: "345 Main St, 14", postalCode: "K1A 0B1" })
    );
  });

  it("does not swallow street words that follow a designator term", () => {
    // "building"/"room" etc. only count as unit designators when a digit-bearing token follows.
    expect(normalizeAddress({ street: "123 Building Road", postalCode: "K1A 0B1" })).toBe(
      "123 building road|K1A0B1"
    );
    expect(normalizeAddress({ street: "50 Room Crescent", postalCode: "K1A 0B1" })).toBe(
      "50 room crescent|K1A0B1"
    );
    // A real unit on such a street is still stripped and groups with the unitless address.
    expect(normalizeAddress({ street: "123 Building Road, Apt 4b", postalCode: "K1A 0B1" })).toBe(
      "123 building road|K1A0B1"
    );
  });
});
