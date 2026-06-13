"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { Button } from "@/app/components/ui/button";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-paper text-ink">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
          <p className="ab-eyebrow">Stoop</p>
          <h1 className="ab-h1">This page needs another try.</h1>
          <p className="ab-body-sm">
            We saved the details for the team. Try again in a moment.
          </p>
          <div>
            <Button onClick={reset}>Try again</Button>
          </div>
        </main>
      </body>
    </html>
  );
}
