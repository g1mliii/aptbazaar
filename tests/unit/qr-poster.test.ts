import QRCode from "qrcode";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// poster.ts / png-encode.ts are "server-only"; stub the guard so they import under vitest.
vi.mock("server-only", () => ({}));

const {
  brandedStorefrontQrSvg,
  bazaarUrl,
  qrPngForUrl,
  shareUrl,
  storefrontQrPng,
  storefrontQrSvg,
  storefrontUrl
} = await import("@/lib/qr/poster");

const BASE = "https://stoop.app";
const PNG_QUIET_ZONE = 4;

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", BASE);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("storefront URLs", () => {
  it("builds the plain storefront URL", () => {
    expect(storefrontUrl("maple-bakery")).toBe(`${BASE}/s/maple-bakery`);
  });

  it("tags share links with the channel", () => {
    expect(shareUrl("maple-bakery", "instagram")).toBe(
      `${BASE}/s/maple-bakery?src=instagram`
    );
  });

  it("builds building bazaar URLs with optional invite codes", () => {
    expect(bazaarUrl("bazaar-abc123")).toBe(`${BASE}/b/bazaar-abc123`);
    expect(bazaarUrl("bazaar-abc123", "ABCD1234")).toBe(
      `${BASE}/b/bazaar-abc123?code=ABCD1234`
    );
  });
});

describe("SVG variants", () => {
  it("emits a plain printable SVG with a QR path", async () => {
    const svg = await storefrontQrSvg("maple-bakery");
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });

  it("composites the verdigris brand mark into the branded SVG", async () => {
    const svg = await brandedStorefrontQrSvg("maple-bakery");
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg.toUpperCase()).toContain("#2E6F62");
  });
});

// Decoder for our own stored-DEFLATE PNG (png-encode.ts). Lets the round-trip test reconstruct the
// module grid and confirm the rasterized QR faithfully represents the storefront URL.
function decodePng(png: Uint8Array): {
  width: number;
  height: number;
  rgb: Uint8Array;
} {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: number[] = [];
  const idat: number[] = [];
  while (p < png.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(
      dv.getUint8(p + 4),
      dv.getUint8(p + 5),
      dv.getUint8(p + 6),
      dv.getUint8(p + 7)
    );
    const dataStart = p + 8;
    if (type === "IHDR") {
      width = dv.getUint32(dataStart);
      height = dv.getUint32(dataStart + 4);
      bitDepth = dv.getUint8(dataStart + 8);
      colorType = dv.getUint8(dataStart + 9);
    } else if (type === "PLTE") {
      palette = [];
      for (let i = 0; i < len; i++) palette.push(dv.getUint8(dataStart + i));
    } else if (type === "IDAT") {
      for (let i = 0; i < len; i++) idat.push(dv.getUint8(dataStart + i));
    }
    p = dataStart + len + 4;
  }

  // Strip the 2-byte zlib header and walk the stored blocks.
  const raw: number[] = [];
  let q = 2;
  while (q < idat.length - 4) {
    const final = idat[q]!;
    const blen = idat[q + 1]! | (idat[q + 2]! << 8);
    q += 5; // 1 flag byte + LEN(2) + NLEN(2)
    for (let i = 0; i < blen; i++) raw.push(idat[q + i]!);
    q += blen;
    if (final === 1) break;
  }

  if (colorType === 3 && bitDepth === 1) {
    const stride = Math.ceil(width / 8);
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      const src = y * (stride + 1) + 1; // skip the per-row filter byte
      for (let x = 0; x < width; x++) {
        const paletteIndex = (raw[src + (x >> 3)]! >> (7 - (x & 7))) & 1;
        const paletteOffset = paletteIndex * 3;
        const rgbOffset = (y * width + x) * 3;
        rgb[rgbOffset] = palette[paletteOffset]!;
        rgb[rgbOffset + 1] = palette[paletteOffset + 1]!;
        rgb[rgbOffset + 2] = palette[paletteOffset + 2]!;
      }
    }
    return { width, height, rgb };
  }

  expect({ bitDepth, colorType }).toEqual({ bitDepth: 8, colorType: 2 });
  const stride = width * 3;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const src = y * (stride + 1) + 1; // skip the per-row filter byte
    for (let i = 0; i < stride; i++) rgb[y * stride + i] = raw[src + i]!;
  }
  return { width, height, rgb };
}

describe("storefrontQrPng", () => {
  it("returns a square PNG with a valid signature", () => {
    const png = storefrontQrPng("maple-bakery", 512);
    expect(Array.from(png.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
    const { width, height } = decodePng(png);
    expect(width).toBe(height);
    expect(width).toBeGreaterThan(0);
  });

  it("is deterministic per slug and differs across slugs", () => {
    const a1 = storefrontQrPng("maple-bakery", 256);
    const a2 = storefrontQrPng("maple-bakery", 256);
    const b = storefrontQrPng("clay-and-co", 256);
    expect(Array.from(a1)).toEqual(Array.from(a2));
    expect(Array.from(a1)).not.toEqual(Array.from(b));
  });

  it("keeps the print-size PNG compact enough for downloads and PDF embedding", () => {
    const png = storefrontQrPng("maple-bakery", 1024);
    expect(png.length).toBeLessThan(200_000);
  });

  it("rasterizes the exact QR matrix for the storefront URL (round-trip)", () => {
    const slug = "maple-bakery";
    const png = storefrontQrPng(slug, 256);
    const { width, rgb } = decodePng(png);

    const matrix = QRCode.create(`${BASE}/s/${slug}`, {
      errorCorrectionLevel: "H"
    }).modules;
    const n = matrix.size;
    const scale = width / (n + PNG_QUIET_ZONE * 2);
    expect(Number.isInteger(scale)).toBe(true);

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const x = Math.floor((col + PNG_QUIET_ZONE) * scale + scale / 2);
        const y = Math.floor((row + PNG_QUIET_ZONE) * scale + scale / 2);
        const dark = rgb[(y * width + x) * 3]! < 128;
        expect(dark).toBe(matrix.data[row * n + col] === 1);
      }
    }
  });

  it("can rasterize a building bazaar URL", () => {
    const png = qrPngForUrl(`${BASE}/b/bazaar-abc123?code=ABCD1234`, 256);
    const { width, height } = decodePng(png);
    expect(width).toBe(height);
    expect(width).toBeGreaterThan(0);
  });
});
