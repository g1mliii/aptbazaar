import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// flyer.ts / poster.ts are "server-only"; stub the guard so they import under vitest.
vi.mock("server-only", () => ({}));

const { buildFlyerPdf } = await import("@/lib/qr/flyer");
const { storefrontQrPng } = await import("@/lib/qr/poster");

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://stoop.app");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function pdfHeader(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes.subarray(0, 5));
}

describe("buildFlyerPdf", () => {
  it("renders a non-empty PDF for US Letter (standard-font fallback)", async () => {
    const pdf = await buildFlyerPdf({
      storeName: "Maple Bakery",
      tagline: "Fresh sourdough, Saturdays",
      storefrontUrl: "https://stoop.app/s/maple-bakery",
      qrPng: storefrontQrPng("maple-bakery", 512),
      pageSize: "letter"
    });
    expect(pdfHeader(pdf)).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("produces a different document for A4 than Letter", async () => {
    const common = {
      storeName: "Maple Bakery",
      tagline: null,
      storefrontUrl: "https://stoop.app/s/maple-bakery",
      qrPng: storefrontQrPng("maple-bakery", 512)
    } as const;
    const letter = await buildFlyerPdf({ ...common, pageSize: "letter" });
    const a4 = await buildFlyerPdf({ ...common, pageSize: "a4" });
    expect(pdfHeader(a4)).toBe("%PDF-");
    expect(letter.length).not.toBe(a4.length);
  });
});
