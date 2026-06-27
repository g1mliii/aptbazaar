import { NextResponse } from "next/server";

import { getImageQueue, getUploadsBucket } from "@/lib/cloudflare/bindings";
import {
  ANON_WINDOW_SECONDS,
  UPLOAD_SELLER_LIMIT,
  uploadSellerKey
} from "@/lib/ratelimit/anon-windows";
import { captureFailure } from "@/lib/observability/capture";
import { getRateLimitKv, incrementWithTtl } from "@/lib/ratelimit/kv";
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES } from "@/lib/schemas/image-upload";
import { isTrustedMutationRequest } from "@/lib/security/csrf";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateToken } from "@/lib/utils/token";

// Phase 3.5 step A (edge, fast): cheap header-level checks, PUT raw bytes to R2's pending
// prefix, insert a `pending` image_uploads row (RLS enforces store ownership), and enqueue a
// job for the container worker. Never on the first-QR critical path.

function isAllowedMime(type: string): boolean {
  return (ALLOWED_UPLOAD_MIME as readonly string[]).includes(type);
}

const MAX_MULTIPART_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

function contentLengthIsTooLarge(request: Request): boolean {
  const raw = request.headers.get("content-length");
  if (!raw) {
    return false;
  }
  const length = Number.parseInt(raw, 10);
  return Number.isFinite(length) && length > MAX_MULTIPART_BODY_BYTES;
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "Refresh the page and try that upload again." },
      { status: 403 }
    );
  }

  const bucket = getUploadsBucket();
  const queue = getImageQueue();
  if (!bucket || !queue) {
    // Uploads require the Worker runtime (R2 + Queue bindings). `next dev` outside the Worker
    // can't process them — fail clearly instead of half-creating a row.
    return NextResponse.json(
      { error: "Photo uploads aren't available here yet." },
      { status: 503 }
    );
  }

  if (contentLengthIsTooLarge(request)) {
    return NextResponse.json(
      { error: "That image didn't work — try a JPG or PNG under 4 MB." },
      { status: 413 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  // Phase 9.3: cap uploads per seller (30/min). Fail-open when KV isn't bound (non-Worker dev).
  const kv = getRateLimitKv();
  if (kv) {
    const limit = await incrementWithTtl(
      kv,
      uploadSellerKey(user.id, Date.now()),
      UPLOAD_SELLER_LIMIT,
      ANON_WINDOW_SECONDS
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "That's a lot of photos at once. Give it a minute." },
        { status: 429 }
      );
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "No image to upload." }, { status: 400 });
  }

  const file = form.get("file");
  const storeId = form.get("storeId");

  if (!(file instanceof File) || typeof storeId !== "string") {
    return NextResponse.json({ error: "No image to upload." }, { status: 400 });
  }
  if (!isAllowedMime(file.type)) {
    return NextResponse.json(
      { error: "That image didn't work — try a JPG or PNG under 4 MB." },
      { status: 415 }
    );
  }
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "That image didn't work — try a JPG or PNG under 4 MB." },
      { status: 413 }
    );
  }

  const keyPending = `uploads/pending/${storeId}/${generateToken()}`;

  // Insert FIRST so RLS rejects a store the caller doesn't own before we write any bytes.
  const { data: row, error: insertError } = await supabase
    .from("image_uploads")
    .insert({
      store_id: storeId,
      key_pending: keyPending,
      requested_by: user.id,
      status: "pending"
    })
    .select("id")
    .single();

  if (insertError || !row) {
    return NextResponse.json(
      { error: "We couldn't start that upload." },
      { status: 403 }
    );
  }

  try {
    await bucket.put(keyPending, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type }
    });
    await queue.send({
      upload_id: row.id,
      store_id: storeId,
      key_pending: keyPending
    });
  } catch (err) {
    captureFailure("image-upload", err, { storeId });
    // Don't strand uploaded bytes or a forever-pending DB row if enqueue/startup fails.
    await bucket.delete(keyPending).catch(() => {});
    try {
      await createSupabaseSecretClient()
        .from("image_uploads")
        .delete()
        .eq("id", row.id)
        .eq("status", "pending");
    } catch {
      // Best-effort rollback only; the client still needs the original startup failure.
    }
    return NextResponse.json(
      { error: "We couldn't start that upload." },
      { status: 502 }
    );
  }

  return NextResponse.json({ uploadId: row.id, status: "pending" });
}
