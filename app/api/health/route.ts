import { NextResponse, type NextRequest } from "next/server";

import { getHealthPayload } from "@/lib/health/checks";
import { optionalEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const deepRequested = request.nextUrl.searchParams.get("deep") === "1";
  const environment =
    optionalEnv("NEXT_PUBLIC_APP_ENV") ?? optionalEnv("APP_ENV") ?? "development";

  if (deepRequested && environment === "production") {
    return NextResponse.json(
      { message: "Deep health checks are not public." },
      { status: 404 }
    );
  }

  const deep = deepRequested;
  const payload = await getHealthPayload(deep);

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store"
    },
    status: payload.status === "degraded" ? 503 : 200
  });
}
