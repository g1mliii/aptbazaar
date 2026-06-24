import { describe, expect, it } from "vitest";

import {
  buildingQrCacheKey,
  isQrFormat,
  QR_FORMATS,
  qrCacheKey,
  qrCacheKeysForStore,
  qrFormatMeta
} from "@/lib/qr/cache-key";

const STORE = "11111111-1111-4111-8111-111111111111";
const BUILDING = "22222222-2222-4222-8222-222222222222";

describe("isQrFormat", () => {
  it("accepts known formats and rejects others", () => {
    expect(isQrFormat("png-1024")).toBe(true);
    expect(isQrFormat("pdf-a4")).toBe(true);
    expect(isQrFormat("gif")).toBe(false);
    expect(isQrFormat("")).toBe(false);
  });
});

describe("qrFormatMeta", () => {
  it("maps each format to an extension + content type", () => {
    expect(qrFormatMeta("svg")).toEqual({ ext: "svg", contentType: "image/svg+xml" });
    expect(qrFormatMeta("png-512").ext).toBe("png");
    expect(qrFormatMeta("pdf-letter").contentType).toBe("application/pdf");
  });
});

describe("qrCacheKey", () => {
  it("is deterministic and shaped qr/<store>/<sha>.<ext>", async () => {
    const key = await qrCacheKey(STORE, {
      slug: "maple-bakery",
      visibility: "qr_only",
      name: "Maple Bakery",
      description: "Sourdough on Saturdays",
      format: "png-512"
    });
    const again = await qrCacheKey(STORE, {
      slug: "maple-bakery",
      visibility: "qr_only",
      name: "Maple Bakery",
      description: "Sourdough on Saturdays",
      format: "png-512"
    });
    expect(key).toBe(again);
    expect(key).toMatch(new RegExp(`^qr/${STORE}/[0-9a-f]{16}\\.png$`));
  });

  it("re-keys when slug, visibility, name, description, or format changes", async () => {
    const base = {
      slug: "maple-bakery",
      visibility: "qr_only",
      name: "Maple Bakery",
      description: "Sourdough on Saturdays",
      format: "svg"
    } as const;
    const key = await qrCacheKey(STORE, base);
    const slugChanged = await qrCacheKey(STORE, { ...base, slug: "maple-bakehouse" });
    const visChanged = await qrCacheKey(STORE, { ...base, visibility: "building" });
    const nameChanged = await qrCacheKey(STORE, { ...base, name: "Maple Bakehouse" });
    const descChanged = await qrCacheKey(STORE, {
      ...base,
      description: "New tagline"
    });
    const descNulled = await qrCacheKey(STORE, { ...base, description: null });
    const fmtChanged = await qrCacheKey(STORE, { ...base, format: "png-512" });
    expect(
      new Set([
        key,
        slugChanged,
        visChanged,
        nameChanged,
        descChanged,
        descNulled,
        fmtChanged
      ]).size
    ).toBe(7);
  });
});

describe("qrCacheKeysForStore", () => {
  it("returns one distinct key per format", async () => {
    const keys = await qrCacheKeysForStore(
      STORE,
      "maple-bakery",
      "qr_only",
      "Maple Bakery",
      "Sourdough on Saturdays"
    );
    expect(keys).toHaveLength(QR_FORMATS.length);
    expect(new Set(keys).size).toBe(QR_FORMATS.length);
  });
});

describe("buildingQrCacheKey", () => {
  it("uses a building-specific prefix and re-keys when invite access changes", async () => {
    const base = {
      slug: "bazaar-abc123",
      accessType: "open",
      inviteCode: null,
      name: "Building bazaar",
      format: "pdf-letter"
    } as const;
    const key = await buildingQrCacheKey(BUILDING, base);
    const inviteKey = await buildingQrCacheKey(BUILDING, {
      ...base,
      accessType: "invite",
      inviteCode: "ABCDEFGH"
    });

    expect(key).toMatch(new RegExp(`^qr/buildings/${BUILDING}/[0-9a-f]{16}\\.pdf$`));
    expect(inviteKey).not.toBe(key);
  });
});
