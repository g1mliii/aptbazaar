"use client";

import * as Sentry from "@sentry/nextjs";
import { Send } from "lucide-react";
import { useState } from "react";

import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Stamp } from "@/app/components/ui/stamp";

export function SentryClientTest() {
  const [eventId, setEventId] = useState<string | null>(null);

  function captureClientEvent() {
    const capturedEventId = Sentry.captureException(
      new Error("Stoop client Sentry test event")
    );
    setEventId(capturedEventId);
  }

  return (
    <Card className="grid gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="ab-eyebrow">Client event</p>
          <h2 className="ab-h2 mt-2">Send a browser test</h2>
        </div>
        <Stamp status={eventId ? "accepted" : "new"}>
          {eventId ? "Captured" : "Waiting"}
        </Stamp>
      </div>
      <p className="ab-body-sm text-ink-2">
        Use this only in development and preview. Production returns not found.
      </p>
      {eventId ? (
        <p className="break-all font-mono text-sm tabular-nums text-ink">
          {eventId}
        </p>
      ) : null}
      <Button onClick={captureClientEvent}>
        <Send aria-hidden="true" />
        Send client event
      </Button>
    </Card>
  );
}
