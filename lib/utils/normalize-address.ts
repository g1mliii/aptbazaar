// Phase 2.8: the ONLY key used for building grouping is normalized_key.
// Hard invariant: a unit/apartment number must never appear in the output — it must
// never reach a building bazaar page, storefront, or API response.

export interface AddressInput {
  street: string;
  postalCode: string;
  city?: string;
}

// The unit token after a designator must contain a digit (`(?=[a-z0-9-]*\d)`); otherwise a
// designator word followed by a plain street word ("Building Road", "Room Crescent") would
// swallow the street name and collapse distinct buildings to the wrong key.
const UNIT_DESIGNATORS =
  /\b(?:apartment|apt|unit|suite|ste|building|bldg|floor|fl|room|rm|number|no|penthouse|ph|basement|bsmt)\b\.?\s*#?\s*(?=[a-z0-9-]*\d)[a-z0-9][a-z0-9-]*/g;

/**
 * Strips unit/apartment information from a single-line street address.
 * Handles explicit designators ("Apt 4B", "Unit 12", "#5", "Suite 200"),
 * leading unit-civic hyphen forms common in Canada ("12-345 Main St"),
 * and comma-separated trailing units ("345 Main St, 12").
 */
function stripUnit(raw: string): string {
  let s = raw.toLowerCase();
  s = s.replace(UNIT_DESIGNATORS, " ");
  s = s.replace(/#\s*[a-z0-9][a-z0-9-]*/g, " ");
  // Leading "12-" / "12 - " unit prefix before the civic number: keep the civic number.
  s = s.replace(/^\s*[a-z0-9]+\s*-\s*(?=\d)/, "");
  // Bare comma-separated trailing unit ("345 Main St, 12" / "345 Main St, #12"): drop the
  // final short token so it groups with the unitless address. Multi-word trailing segments
  // (a real street continuation) are left intact.
  s = s.replace(/,\s*#?\s*[a-z0-9][a-z0-9-]*\s*$/, " ");
  s = s.replace(/,/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normalizePostalCode(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "");
}

/**
 * Returns the building grouping key: `<street without unit>|<POSTALCODE>`.
 * Stable across casing, whitespace, and unit presence — two units in the same
 * building always collapse to the same key.
 */
export function normalizeAddress(input: AddressInput): string {
  const street = stripUnit(input.street);
  const postalCode = normalizePostalCode(input.postalCode);
  return `${street}|${postalCode}`;
}
