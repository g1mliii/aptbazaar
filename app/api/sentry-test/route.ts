import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { appEnvironment } from "@/lib/env";

export const dynamic = "force-dynamic";

export function GET() {
  if (appEnvironment === "production") {
    return NextResponse.json(
      { message: "Sentry test events are disabled in production." },
      { status: 404 }
    );
  }

  const eventId = Sentry.captureException(
    new Error("Stoop server Sentry test event")
  );

  return NextResponse.json(
    { eventId, message: "Sentry server test event captured." },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
