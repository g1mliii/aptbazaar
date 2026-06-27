import sharp from "sharp";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ANIMATED_REASON,
  GENERIC_REASON,
  processImage
} from "./process-image.mjs";

// Phase 9.4: adversarial fixtures for the image sanitizer. Every category of bad file must be
// rejected; a legitimate (even polyglot-padded) photo must be re-encoded to clean WebP.

async function solidJpeg(width = 16, height = 16) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } }
  })
    .jpeg()
    .toBuffer();
}

// A hand-built 2-frame animated GIF (1x1). GIF is a disallowed format, so this also covers the
// "animated GIF" rejection path; the animated-WebP case below exercises the frame-count guard for
// an allowed format.
const ANIMATED_GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, // logical screen descriptor (1x1, GCT)
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff, // global color table: black, white
  0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e,
  0x30, 0x03, 0x01, 0x00, 0x00, 0x00, // NETSCAPE2.0 loop extension
  0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, // frame 1 graphic control
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // frame 1 image descriptor
  0x02, 0x02, 0x44, 0x01, 0x00, // frame 1 LZW data
  0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, // frame 2 graphic control
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // frame 2 image descriptor
  0x02, 0x02, 0x44, 0x01, 0x00, // frame 2 LZW data
  0x3b // trailer
]);

describe("processImage", () => {
  it("accepts a real JPEG and returns clean WebP", async () => {
    const result = await processImage(await solidJpeg());
    expect(result.ok).toBe(true);
    // WebP magic: "RIFF"...."WEBP".
    expect(result.data.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(result.data.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("clamps an oversized image to the max edge", async () => {
    const huge = await sharp({
      create: { width: 3000, height: 1200, channels: 3, background: { r: 10, g: 10, b: 10 } }
    })
      .png()
      .toBuffer();
    const result = await processImage(huge);
    expect(result.ok).toBe(true);
    expect(result.width).toBe(2048);
    expect(result.height).toBeLessThanOrEqual(2048);
  });

  it("rejects an SVG (vector / script-bearing)", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
    );
    const result = await processImage(svg);
    expect(result).toEqual({ ok: false, reason: GENERIC_REASON });
  });

  it("rejects a non-image / fake-extension payload", async () => {
    const result = await processImage(Buffer.from("<!doctype html><script>alert(1)</script>"));
    expect(result.ok).toBe(false);
  });

  it("rejects an empty or oversized buffer", async () => {
    expect((await processImage(Buffer.alloc(0))).ok).toBe(false);
    expect((await processImage(Buffer.alloc(4 * 1024 * 1024 + 1))).ok).toBe(false);
  });

  it("rejects an animated GIF", async () => {
    const result = await processImage(Buffer.from(ANIMATED_GIF));
    expect(result.ok).toBe(false);
  });

  it("sanitizes a polyglot (real JPEG + trailing HTML) to clean WebP", async () => {
    const polyglot = Buffer.concat([
      await solidJpeg(),
      Buffer.from("\n<script>alert('xss')</script>")
    ]);
    const result = await processImage(polyglot);
    expect(result.ok).toBe(true);
    expect(result.data.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // The trailing script bytes are gone — the output is a fresh re-encode, not a copy.
    expect(result.data.toString("latin1")).not.toContain("script");
  });

  it("rejects an animated WebP with the animated reason", async () => {
    let animatedWebp;
    try {
      animatedWebp = await sharp(Buffer.from(ANIMATED_GIF), { animated: true })
        .webp()
        .toBuffer();
    } catch {
      animatedWebp = null;
    }
    // Skip only if this libvips build can't read GIF to synthesize the fixture.
    if (!animatedWebp) return;

    const meta = await sharp(animatedWebp).metadata();
    if ((meta.pages ?? 1) <= 1) return; // not actually multi-frame; nothing to assert

    const result = await processImage(animatedWebp);
    expect(result).toEqual({ ok: false, reason: ANIMATED_REASON });
  });
});

describe("image processor container image", () => {
  it("copies every runtime module imported by server.mjs", () => {
    const dockerfile = readFileSync("container/Dockerfile", "utf8");
    expect(dockerfile).toMatch(/COPY\s+server\.mjs\s+process-image\.mjs\s+\.\//);
  });
});
