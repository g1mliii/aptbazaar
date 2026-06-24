import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizeContactAddress } from "@/lib/utils/normalize-address";

const streetName = fc.constantFrom(
  "Maple Street",
  "King Road",
  "Queen Avenue",
  "Oak Boulevard",
  "Elm Drive"
);
const civic = fc.integer({ min: 1, max: 9999 });
const city = fc.constantFrom("Toronto", "Ottawa", "Buffalo", "Detroit");
const postal = fc.constantFrom("M5V 2T6", "K1A 0B1", "14201", "48226");
const unit = fc.constantFrom("4", "12B", "200", "PH2");

function variants(street: string, place: string, code: string, u: string): string[] {
  return [
    `${street}, ${place}, ${code}`,
    `  ${street.toUpperCase()}  , ${place}, ${code.toLowerCase()} `,
    `${street}, Apt ${u}, ${place}, ${code}`,
    `${street} Unit ${u}, ${place}, ${code}`,
    `${street} #${u}, ${place}, ${code}`,
    `#${u} ${street}, ${place}, ${code}`,
    `${u}-${street}, ${place}, ${code}`
  ];
}

describe("building grouping key", () => {
  it("keeps unit, casing, and whitespace variants in the same building", () => {
    fc.assert(
      fc.property(civic, streetName, city, postal, unit, (n, name, place, code, u) => {
        const street = `${n} ${name}`;
        const expected = normalizeContactAddress(`${street}, ${place}, ${code}`);
        expect(expected).not.toBeNull();

        for (const address of variants(street, place, code, u)) {
          expect(normalizeContactAddress(address)).toBe(expected);
        }
      })
    );
  });

  it("does not collide across different postal codes", () => {
    fc.assert(
      fc.property(civic, streetName, city, (n, name, place) => {
        const street = `${n} ${name}`;
        const canada = normalizeContactAddress(`${street}, ${place}, K1A 0B1`);
        const us = normalizeContactAddress(`${street}, ${place}, 14201`);
        expect(canada).not.toBeNull();
        expect(us).not.toBeNull();
        expect(canada).not.toBe(us);
      })
    );
  });

  it("does not group addresses without a postal code", () => {
    expect(normalizeContactAddress("120 Maple Street, Unit 4")).toBeNull();
  });

  it("keys on the ZIP, not a 5-digit house number", () => {
    const key = normalizeContactAddress("12345 Main Street, Buffalo, NY 14201");
    expect(key).toBe("12345 main street|14201");
    // A neighbor in the same building who wrote a unit must collapse to the same key.
    expect(normalizeContactAddress("12345 Main Street, Apt 8B, Buffalo, NY 14201")).toBe(key);
    // A different building (different ZIP) on the same-numbered street must not collide.
    expect(normalizeContactAddress("12345 Main Street, Detroit, MI 48226")).not.toBe(key);
  });
});
