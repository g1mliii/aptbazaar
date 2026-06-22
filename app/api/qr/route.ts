import { NextResponse } from "next/server";

import { getQrBucket } from "@/lib/cloudflare/bindings";
import {
  isQrFormat,
  qrCacheKey,
  qrFormatMeta,
  type QrFormat
} from "@/lib/qr/cache-key";
import { buildFlyerPdf, type FlyerPageSize } from "@/lib/qr/flyer";
import { storefrontQrPng, storefrontQrSvg, storefrontUrl } from "@/lib/qr/poster";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 7.2: authed binary downloads (SVG / PNG / branded PDF flyer). Binary formats can't be
// client-blobbed cleanly, so the dashboard buttons are plain links here. The seller is resolved
// from their session (never a client-supplied store id), and generated assets are cached in R2
// keyed by a content hash so a re-download is a cheap read. Each cached object stamps the store's
// slug + visibility in metadata so the Phase 7.6 sweep can reclaim it after a change.

export const dynamic = "force-dynamic";

const FONT_KEYS = {
  display: "fonts/instrument-serif.ttf",
  body: "fonts/inter-tight.ttf"
} as const;

function toBytes(value: Uint8Array | string): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

async function loadFont(
  bucket: R2Bucket | null,
  key: string
): Promise<Uint8Array | undefined> {
  if (!bucket) return undefined;
  try {
    const object = await bucket.get(key);
    if (!object) return undefined;
    return new Uint8Array(await object.arrayBuffer());
  } catch {
    return undefined;
  }
}

async function generate(
  format: QrFormat,
  store: { slug: string; name: string; description: string | null },
  bucket: R2Bucket | null
): Promise<Uint8Array> {
  switch (format) {
    case "svg":
      return toBytes(await storefrontQrSvg(store.slug));
    case "png-512":
      return storefrontQrPng(store.slug, 512);
    case "png-1024":
      return storefrontQrPng(store.slug, 1024);
    case "pdf-letter":
    case "pdf-a4": {
      const qrPng = storefrontQrPng(store.slug, 1024);
      const [display, body] = await Promise.all([
        loadFont(bucket, FONT_KEYS.display),
        loadFont(bucket, FONT_KEYS.body)
      ]);
      const pageSize: FlyerPageSize = format === "pdf-a4" ? "a4" : "letter";
      return buildFlyerPdf({
        storeName: store.name,
        tagline: store.description,
        storefrontUrl: storefrontUrl(store.slug),
        qrPng,
        pageSize,
        fonts: { display, body }
      });
    }
  }
}

function downloadName(format: QrFormat, slug: string): string {
  const meta = qrFormatMeta(format);
  const prefix = meta.ext === "pdf" ? "stoop-flyer" : "stoop-qr";
  return `${prefix}-${slug}.${meta.ext}`;
}

export async function GET(request: Request): Promise<Response> {
  const format = new URL(request.url).searchParams.get("format") ?? "";
  if (!isQrFormat(format)) {
    return NextResponse.json({ error: "Pick a download format." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  // RLS scopes this to the signed-in seller's own store.
  const { data: store } = await supabase
    .from("stores")
    .select("id, slug, name, description, visibility")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!store) {
    return NextResponse.json({ error: "Set up your store first." }, { status: 404 });
  }

  const bucket = getQrBucket();
  const cacheKey = await qrCacheKey(store.id, {
    slug: store.slug,
    visibility: store.visibility,
    name: store.name,
    description: store.description,
    format
  });
  const { contentType } = qrFormatMeta(format);
  const headers = {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${downloadName(format, store.slug)}"`,
    "Cache-Control": "private, max-age=3600"
  };

  if (bucket) {
    try {
      const cached = await bucket.get(cacheKey);
      if (cached) {
        return new Response(cached.body, { headers });
      }
    } catch {
      // Cache miss-on-error: fall through and regenerate.
    }
  }

  const bytes = await generate(format, store, bucket);

  if (bucket) {
    try {
      await bucket.put(cacheKey, bytes, {
        httpMetadata: { contentType },
        customMetadata: {
          slug: store.slug,
          visibility: store.visibility,
          name: store.name,
          description: store.description ?? ""
        }
      });
    } catch {
      // Best-effort cache write — the seller still gets their file.
    }
  }

  // The Uint8Array is a valid BufferSource body; the cast sidesteps the ArrayBuffer vs
  // ArrayBufferLike generic mismatch in the DOM BodyInit type.
  return new Response(bytes as BodyInit, { headers });
}
