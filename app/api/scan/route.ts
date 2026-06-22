import { scanParamsSchema } from "@/lib/schemas/scan";
import { createSupabaseSecretClient } from "@/lib/supabase/secret";

// Phase 7.4: the public, unauthenticated scan beacon. The storefront mounts a 1×1 <img> pointing
// here with ?store=&src=; we bump a per-(store, channel, day) counter and always answer with a
// transparent GIF. No IP, user-agent, fingerprint, or derived visitor identifier is persisted. The
// write goes through the service-role record_scan() RPC (the table has no public write policy), and
// the SQL function shards hot counter rows so the beacon path does not need a KV write in front of
// every scan.

export const dynamic = "force-dynamic";

// 1×1 transparent GIF. Returned for every request (valid, throttled, or malformed) so the beacon
// never surfaces anything to the visitor.
const TRANSPARENT_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
  0x3b
]);

function gifResponse(): Response {
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store"
    }
  });
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const parsed = scanParamsSchema.safeParse({
    store: searchParams.get("store"),
    src: searchParams.get("src") ?? undefined
  });
  if (!parsed.success) {
    return gifResponse();
  }
  const { store, src } = parsed.data;

  try {
    const { error } = await createSupabaseSecretClient().rpc("record_scan", {
      p_store_id: store,
      p_src: src
    });
    if (error) {
      throw error;
    }
  } catch {
    // Scan counts are a soft metric — a write failure must never break the storefront's pixel.
  }

  return gifResponse();
}
