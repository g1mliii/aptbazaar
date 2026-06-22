import "server-only";

import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB
} from "pdf-lib";

// Phase 7.3: the printable flyer. pdf-lib is pure JS and Workers-safe (unlike @react-pdf/renderer
// or headless Chromium). The only delta between US Letter and A4 is the page rectangle — the layout
// is shared. Custom display/body fonts (Instrument Serif, Inter Tight) ride in as raw bytes fetched
// from R2 because Workers can't read fonts off disk; when they're absent we fall back to the
// built-in standard fonts so the builder still works in tests and `next dev`.

export type FlyerPageSize = "letter" | "a4";

export interface FlyerFonts {
  display?: Uint8Array;
  body?: Uint8Array;
}

export interface FlyerInput {
  storeName: string;
  tagline?: string | null;
  storefrontUrl: string;
  qrPng: Uint8Array;
  pageSize: FlyerPageSize;
  fonts?: FlyerFonts;
}

// Points (1/72"). pdf-lib is unit-agnostic; these are the standard page rectangles.
const PAGE_DIMENSIONS: Record<FlyerPageSize, { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 }
};

const PAPER = hex(0xf6, 0xf5, 0xf1);
const INK = hex(0x1c, 0x1a, 0x16);
const INK_3 = hex(0x8a, 0x82, 0x74);
const MARK_DARK = hex(0x1c, 0x15, 0x0a);
const VERDIGRIS = hex(0x2e, 0x6f, 0x62);
const WHITE = hex(0xff, 0xff, 0xff);

function hex(r: number, g: number, b: number): RGB {
  return rgb(r / 255, g / 255, b / 255);
}

/** Shrink `size` until `text` fits within `maxWidth`. */
function fitFontSize(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number
): number {
  let current = size;
  while (current > 8 && font.widthOfTextAtSize(text, current) > maxWidth) {
    current -= 1;
  }
  return current;
}

function drawCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  y: number,
  color: RGB,
  pageWidth: number
): void {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: (pageWidth - width) / 2,
    y,
    size,
    font,
    color
  });
}

// The Stoop mark, geometry-for-geometry from app/assets/brand/logo-mark.svg, drawn over the QR's
// center. PDF's origin is bottom-left, so y is measured up from the cell's bottom edge.
function drawBrandMark(page: PDFPage, cx: number, cy: number, edge: number): void {
  const unit = edge / 64;
  const ox = cx - edge / 2;
  const oy = cy - edge / 2;
  const rect = (x: number, y: number, w: number, h: number, color: RGB) =>
    page.drawRectangle({
      x: ox + x * unit,
      // flip y: SVG measures from the top, PDF from the bottom.
      y: oy + (64 - y - h) * unit,
      width: w * unit,
      height: h * unit,
      color
    });
  rect(0, 0, 64, 64, MARK_DARK);
  rect(10, 10, 44, 44, WHITE);
  rect(20, 20, 24, 24, VERDIGRIS);
  rect(46, 46, 10, 10, MARK_DARK);
  rect(49, 49, 4, 4, VERDIGRIS);
}

export async function buildFlyerPdf(input: FlyerInput): Promise<Uint8Array> {
  const { width, height } = PAGE_DIMENSIONS[input.pageSize];

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const displayFont = input.fonts?.display
    ? await doc.embedFont(input.fonts.display, { subset: true })
    : await doc.embedFont(StandardFonts.TimesRoman);
  const bodyFont = input.fonts?.body
    ? await doc.embedFont(input.fonts.body, { subset: true })
    : await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.addPage([width, height]);

  // Limestone canvas + a thin ink rule, the kit's poster frame.
  page.drawRectangle({ x: 0, y: 0, width, height, color: PAPER });
  const margin = width * 0.08;
  page.drawRectangle({
    x: margin,
    y: margin,
    width: width - margin * 2,
    height: height - margin * 2,
    borderColor: INK,
    borderWidth: 1,
    color: PAPER
  });

  const contentWidth = width - margin * 2 - width * 0.06;

  // Store name (display serif), centered near the top.
  const nameSize = fitFontSize(displayFont, input.storeName, 40, contentWidth);
  drawCentered(
    page,
    input.storeName,
    displayFont,
    nameSize,
    height - margin - 64,
    INK,
    width
  );

  // Optional tagline (body).
  const tagline = input.tagline?.trim();
  if (tagline) {
    const tagSize = fitFontSize(bodyFont, tagline, 14, contentWidth);
    drawCentered(
      page,
      tagline,
      bodyFont,
      tagSize,
      height - margin - 64 - 28,
      INK_3,
      width
    );
  }

  // QR on a white rounded card, with the brand mark overlaid at its center.
  const qrEdge = Math.min(width - margin * 2 - 96, height * 0.42);
  const cardPad = qrEdge * 0.08;
  const cardEdge = qrEdge + cardPad * 2;
  const cardX = (width - cardEdge) / 2;
  const cardY = (height - cardEdge) / 2 - 8;
  page.drawRectangle({
    x: cardX,
    y: cardY,
    width: cardEdge,
    height: cardEdge,
    color: WHITE,
    borderColor: INK,
    borderWidth: 1
  });

  const qrImage = await doc.embedPng(input.qrPng);
  page.drawImage(qrImage, {
    x: cardX + cardPad,
    y: cardY + cardPad,
    width: qrEdge,
    height: qrEdge
  });
  drawBrandMark(page, width / 2, cardY + cardEdge / 2, qrEdge * 0.2);

  // Call to action + URL near the bottom (kit voice).
  drawCentered(
    page,
    `Scan to order from ${input.storeName}.`,
    bodyFont,
    16,
    cardY - 40,
    INK,
    width
  );
  drawCentered(
    page,
    input.storefrontUrl.replace(/^https?:\/\//, ""),
    bodyFont,
    11,
    cardY - 60,
    INK_3,
    width
  );

  return doc.save();
}
