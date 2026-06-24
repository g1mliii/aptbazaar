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

const PUBLIC_UNIT_HINTS =
  /\b(?:apartment|apt|unit|suite|ste|floor|fl|room|rm|number|no|penthouse|ph|basement|bsmt)\b\.?\s*#?\s*(?=[a-z0-9-]*\d)[a-z0-9][a-z0-9-]*|#\s*[a-z0-9][a-z0-9-]*\b/i;

export function containsLikelyUnitNumber(value: string): boolean {
  return PUBLIC_UNIT_HINTS.test(value);
}

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

// Canadian postal (A1A 1A1) and US ZIP (12345 / 12345-6789). The postal code is the load-bearing
// half of the grouping key, so a free-text address with no detectable postal can't be grouped.
const CA_POSTAL = /\b([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)\b/;
// Global so we can scan every 5-digit run: a 5-digit civic/house number ("12345 Main St") also
// matches \d{5}, so we take the LAST run — the ZIP terminates a US address, the house number leads
// it. A trailing-only strip keeps the house number on the street line (see normalizeContactAddress).
const US_ZIP = /\b(\d{5})(?:-\d{4})?\b/g;
const US_ZIP_TRAILING = /\b\d{5}(?:-\d{4})?\s*$/;

/**
 * Building grouping key from a single free-text contact address (e.g.
 * "120 Maple St, Toronto, ON M5V 2K7"). The street line is taken as the first comma segment (the
 * civic + street convention) with any postal token stripped out; the postal code is extracted by
 * pattern. Returns null when no postal code is present — without it we never risk grouping two
 * different buildings together. This is the canonical normalizer the building-grouping cron reads
 * off `stores.normalized_key`; SQL never re-implements it (hard invariant 2).
 */
export function normalizeContactAddress(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  let postalCode: string | null = null;
  const ca = value.match(CA_POSTAL);
  if (ca) {
    postalCode = `${ca[1]}${ca[2]}`;
  } else {
    const usMatches = [...value.matchAll(US_ZIP)];
    const last = usMatches[usMatches.length - 1];
    if (last) {
      postalCode = last[1] ?? null;
    }
  }
  if (!postalCode) {
    return null;
  }

  const firstSegment = value.split(",")[0] ?? value;
  // Strip a postal code from the street line, but only a TRAILING US ZIP — a leading 5-digit run is
  // the house number and must stay (it distinguishes buildings on the same street + postal).
  const street = firstSegment
    .replace(CA_POSTAL, " ")
    .replace(US_ZIP_TRAILING, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!street) {
    return null;
  }

  return normalizeAddress({ street, postalCode });
}
