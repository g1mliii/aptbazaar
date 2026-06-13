import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Stamp } from "@/app/components/ui/stamp";
import { appEnvironment } from "@/lib/env";

import { SentryClientTest } from "./client-test";

export const dynamic = "force-dynamic";

export default function SentryTestPage() {
  if (appEnvironment === "production") {
    notFound();
  }

  return (
    <main className="min-h-screen bg-paper px-4 py-8 text-ink sm:px-8">
      <div className="mx-auto grid max-w-3xl gap-6">
        <div className="grid gap-4">
          <Stamp status="new">Preview only</Stamp>
          <h1 className="ab-display-md">Sentry test counter</h1>
          <p className="ab-body text-ink-2">
            Send one server event and one browser event before closing Phase 1.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="grid gap-5">
            <div>
              <p className="ab-eyebrow">Server event</p>
              <h2 className="ab-h2 mt-2">Send a route test</h2>
            </div>
            <p className="ab-body-sm text-ink-2">
              The route captures a server exception and returns the event id.
            </p>
            <Button asChild>
              <Link href="/api/sentry-test">
                Open server route
                <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
          </Card>
          <SentryClientTest />
        </div>
      </div>
    </main>
  );
}
