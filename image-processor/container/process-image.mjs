import sharp from "sharp";

// Phase 3.5 step B (native), extracted from server.mjs so the sanitizer can be unit-tested with
// crafted adversarial inputs (Phase 9.4). Re-encoding to WebP is itself the polyglot defense:
// anything sharp can't decode as a real raster image is rejected, and a successful decode strips
// any trailing/leading non-image payload along with all EXIF.

export const MAX_EDGE = 2048;
export const MAX_BYTES = 4 * 1024 * 1024;
export const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
export const GENERIC_REASON = "That image didn't work — try a JPG or PNG under 4 MB.";
export const ANIMATED_REASON = "Animated images aren't supported yet — try a still photo.";

/**
 * Validate + re-encode an uploaded image buffer.
 * @returns {Promise<{ ok: true, data: Buffer, width: number, height: number }
 *   | { ok: false, reason: string }>}
 */
export async function processImage(buf) {
  if (!buf || buf.length === 0 || buf.length > MAX_BYTES) {
    return { ok: false, reason: GENERIC_REASON };
  }

  try {
    const image = sharp(buf, { failOn: "error" });
    const meta = await image.metadata();

    // Reject svg (vector / script-bearing), unknown formats, and animated frames.
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
      return { ok: false, reason: GENERIC_REASON };
    }
    if ((meta.pages ?? 1) > 1) {
      return { ok: false, reason: ANIMATED_REASON };
    }

    const { data, info } = await image
      .rotate() // bake EXIF orientation, then drop all metadata (default) to strip EXIF
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return { ok: true, data, width: info.width, height: info.height };
  } catch {
    return { ok: false, reason: GENERIC_REASON };
  }
}
