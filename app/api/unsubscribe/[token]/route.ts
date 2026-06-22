import { appBaseUrl } from "@/lib/env";
import { unsubscribeByToken } from "@/lib/subscribers/unsubscribe";

// Phase 6.7a: the RFC 8058 one-click unsubscribe target. This is the URL in the List-Unsubscribe
// header, so Gmail/Apple Mail's native "Unsubscribe" button POSTs here with the body
// `List-Unsubscribe=One-Click`. App Router won't allow a page.tsx and a route.ts in the same
// segment, so the human-facing kit card lives at /u/[token] and this machine endpoint sits beside
// it. Both verbs run the same idempotent helper. A GET (a plain mail client following the link)
// redirects to the friendly page.

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params;
  const result = await unsubscribeByToken(token);
  if (!result.ok && result.reason === "write_failed") {
    return new Response(null, { status: 500 });
  }

  // One-click expects a 2xx regardless — unknown/already-unsubscribed are both no-ops.
  return new Response(null, { status: 200 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params;
  return Response.redirect(`${appBaseUrl()}/u/${encodeURIComponent(token)}`, 302);
}
