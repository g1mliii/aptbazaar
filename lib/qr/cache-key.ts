// Phase 7.6: the content-addressed R2 cache key for generated QR assets. Deliberately free of
// `server-only` and any Node built-in — it runs both in the Next route (generate + cache) and in
// the Worker sweep cron (orphan cleanup), so it leans only on Web Crypto, which both runtimes
// expose as the global `crypto`. The key folds in everything that changes the rendered output
// (slug, visibility, and — because the PDF flyer prints them — store name + description); any of
// those changing yields a new key and naturally orphans the old object, which the weekly sweep then
// reclaims by comparing the same fields stamped in customMetadata.

export type QrFormat = "svg" | "png-512" | "png-1024" | "pdf-letter" | "pdf-a4";

export const QR_FORMATS: readonly QrFormat[] = [
  "svg",
  "png-512",
  "png-1024",
  "pdf-letter",
  "pdf-a4"
];

export function isQrFormat(value: string): value is QrFormat {
  return (QR_FORMATS as readonly string[]).includes(value);
}

export interface QrFormatMeta {
  ext: "svg" | "png" | "pdf";
  contentType: string;
}

export function qrFormatMeta(format: QrFormat): QrFormatMeta {
  switch (format) {
    case "svg":
      return { ext: "svg", contentType: "image/svg+xml" };
    case "png-512":
    case "png-1024":
      return { ext: "png", contentType: "image/png" };
    case "pdf-letter":
    case "pdf-a4":
      return { ext: "pdf", contentType: "application/pdf" };
  }
}

export interface QrCacheInputs {
  slug: string;
  visibility: string;
  name: string;
  description: string | null;
  format: QrFormat;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** R2 key: `qr/<store_id>/<sha>.<ext>`, where <sha> hashes the rendering inputs. */
export async function qrCacheKey(
  storeId: string,
  inputs: QrCacheInputs
): Promise<string> {
  const canonical = JSON.stringify({
    slug: inputs.slug,
    visibility: inputs.visibility,
    name: inputs.name,
    description: inputs.description,
    format: inputs.format
  });
  const sha = (await sha256Hex(canonical)).slice(0, 16);
  return `qr/${storeId}/${sha}.${qrFormatMeta(inputs.format).ext}`;
}

/** All current cache keys for a store across every format — the sweep's "keep" set. */
export async function qrCacheKeysForStore(
  storeId: string,
  slug: string,
  visibility: string,
  name: string,
  description: string | null
): Promise<string[]> {
  return Promise.all(
    QR_FORMATS.map((format) =>
      qrCacheKey(storeId, { slug, visibility, name, description, format })
    )
  );
}
