import Link from "next/link";

import { Logo } from "@/app/components/brand/logo";

// Phase 8.5: one response for every non-renderable bazaar — missing building, wrong/expired code, or
// a building with no public sellers yet. Identical copy in all cases so a private bazaar can't be
// enumerated. Neighborly voice, no error code.
export default function BazaarNotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-28 leading-tight text-ink">
        This is a private stoop.
      </h1>
      <p className="mt-3 text-15 text-ink-2">
        Use the code from your building&apos;s QR poster to come in. If you scanned a
        printed code, it may have been refreshed — ask whoever shared it for the latest
        one.
      </p>
      <Link
        aria-label="Stoop home"
        className="mt-8 inline-flex items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
        href="/"
      >
        <Logo size={26} variant="wordmark" />
      </Link>
    </main>
  );
}
