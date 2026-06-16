import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// Phase 2.7: magic-link landing. Supabase redirects here with a PKCE `code`; we exchange
// it for a session (cookies set by the @supabase/ssr server client) and send the seller on.

export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next") ?? "/dashboard";
  // Only allow same-site relative paths; reject protocol-relative ("//evil") and
  // backslash ("/\evil") bypasses so `next` can't redirect off-site.
  const safeNext =
    requestedNext.startsWith("/") &&
    !requestedNext.startsWith("//") &&
    !requestedNext.startsWith("/\\")
      ? requestedNext
      : "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, origin));
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link-expired`);
}
