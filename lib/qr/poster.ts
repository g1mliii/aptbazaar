import "server-only";

import QRCode from "qrcode";

import { requiredEnv } from "@/lib/env";

import { rasterizeQrPng, type ModuleMatrix, type Rgb } from "./png-encode";

// Phase 7.1: the full sharing system. storefrontQrSvg stays the plain, max-contrast printable QR
// (no tracking suffix, reliability never depends on an overlay). On top of it: shareable links
// with a ?src= channel tag, PNG buffers for downloads, and a branded SVG that drops the Stoop
// mark into the finder cell (bumped to error-correction H so the occlusion is safe).

/** Public storefront URL for a store slug. No tracking suffix on the printable version. */
export function storefrontUrl(slug: string): string {
  const base = requiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/+$/, "");
  return `${base}/s/${slug}`;
}

/** Storefront URL tagged with a share channel — only ever used for shareable links, never print. */
export function shareUrl(slug: string, src: string): string {
  return `${storefrontUrl(slug)}?src=${encodeURIComponent(src)}`;
}

/**
 * Public building-bazaar URL (Phase 8.6). For invite buildings the printed QR carries the shared
 * code so a scan lands through the middleware's code → cookie exchange straight onto the bazaar.
 */
export function bazaarUrl(slug: string, code?: string | null): string {
  const base = requiredEnv("NEXT_PUBLIC_APP_URL").replace(/\/+$/, "");
  const url = `${base}/b/${slug}`;
  return code ? `${url}?code=${encodeURIComponent(code)}` : url;
}

// The QR library needs concrete color literals (it's image data, not a styleable surface).
// `dark` is the --ab-ink token value; the printable SVG keeps a transparent light so the poster
// card shows through. Downloads/flyers fill white for maximum contrast off-card.
const QR_INK = "#1C1A16";
const QR_INK_RGB: Rgb = [0x1c, 0x1a, 0x16];
const QR_WHITE_RGB: Rgb = [0xff, 0xff, 0xff];
const QR_TRANSPARENT = "#00000000";

// Standard quiet zone (4 modules) on the rasterized downloads so a phone camera locks on reliably
// even when the poster sits against a busy wall.
const PNG_QUIET_ZONE = 4;

/** Inline SVG QR for any URL (transparent light so the poster card shows through). */
export async function qrSvgForUrl(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: QR_INK, light: QR_TRANSPARENT }
  });
}

/** PNG QR for any URL (plain ink on white, max contrast). `size` is an approximate edge in pixels. */
export function qrPngForUrl(url: string, size: number): Uint8Array {
  const matrix = qrModules(url, "H");
  const scale = Math.max(1, Math.floor(size / (matrix.size + PNG_QUIET_ZONE * 2)));
  return rasterizeQrPng(matrix, scale, PNG_QUIET_ZONE, QR_INK_RGB, QR_WHITE_RGB);
}

/** Returns an inline SVG QR string for the store's public storefront. */
export async function storefrontQrSvg(slug: string): Promise<string> {
  return qrSvgForUrl(storefrontUrl(slug));
}

/**
 * SVG QR with the Stoop mark composited into the center cell. Bumped to error-correction H so the
 * logo occlusion stays well within the recoverable area. The mark is inlined (not imported from the
 * gitignored kit) so the downloaded file is self-contained.
 */
export async function brandedStorefrontQrSvg(slug: string): Promise<string> {
  const url = storefrontUrl(slug);
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "H",
    color: { dark: QR_INK, light: "#FFFFFF" }
  });
  const matrix = qrModules(url, "H");
  const dim = matrix.size + 2; // viewBox is (size + margin*2); margin is 1 each side.
  return svg.replace("</svg>", `${brandMarkSvg(dim)}</svg>`);
}

/** PNG QR (plain ink on white, max contrast). `size` is an approximate target edge in pixels. */
export function storefrontQrPng(slug: string, size: number): Uint8Array {
  return qrPngForUrl(storefrontUrl(slug), size);
}

function qrModules(text: string, errorCorrectionLevel: "M" | "H"): ModuleMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel });
  return {
    size: qr.modules.size,
    data: qr.modules.data
  };
}

// The Stoop mark, geometry-for-geometry from app/assets/brand/logo-mark.svg, scaled and centered
// over a white backing rect (~24% of the QR edge — comfortably inside the H-level recovery budget).
function brandMarkSvg(dim: number): string {
  const markSize = dim * 0.24;
  const origin = (dim - markSize) / 2;
  const pad = markSize * 0.14;
  return (
    `<rect x="${origin - pad}" y="${origin - pad}" width="${markSize + pad * 2}" height="${markSize + pad * 2}" rx="${markSize * 0.16}" fill="#FFFFFF"/>` +
    `<svg x="${origin}" y="${origin}" width="${markSize}" height="${markSize}" viewBox="0 0 64 64">` +
    `<rect x="0" y="0" width="64" height="64" rx="12" fill="#1C150A"/>` +
    `<rect x="10" y="10" width="44" height="44" rx="6" fill="#FFFFFF"/>` +
    `<rect x="20" y="20" width="24" height="24" rx="3" fill="#2E6F62"/>` +
    `<rect x="46" y="46" width="10" height="10" rx="2" fill="#1C150A"/>` +
    `<rect x="49" y="49" width="4" height="4" rx="1" fill="#2E6F62"/>` +
    `</svg>`
  );
}
