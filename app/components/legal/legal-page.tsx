import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/app/components/brand/logo";

// Phase 10.5: shared chrome for /privacy and /terms. No kit reference exists for static legal
// pages, so this is built in the kit's spirit from --ab-* tokens (serif display headings, Inter
// body, paper/ink palette). Flagged as a kit gap in the plan.

export function LegalPage({
  title,
  updated,
  intro,
  children
}: {
  title: string;
  updated: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-paper px-4 py-10 text-ink sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/" aria-label="Stoop home" className="inline-block">
          <Logo variant="wordmark" size={40} />
        </Link>

        <header className="mt-8">
          <h1 className="font-display text-40 leading-none text-ink">{title}</h1>
          <p className="mt-2 font-mono text-12 uppercase tracking-[0.12em] text-ink-3">
            Last updated {updated}
          </p>
          <p className="mt-4 text-16 text-ink-2">{intro}</p>
        </header>

        <div className="mt-8 flex flex-col gap-8">{children}</div>

        <p className="mt-12 text-13 text-ink-3">
          Questions? Email{" "}
          <a href="mailto:help@stoop.app" className="font-semibold text-verdigris">
            help@stoop.app
          </a>
          . See also our{" "}
          <Link href="/privacy" className="font-semibold text-verdigris">
            privacy policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="font-semibold text-verdigris">
            terms
          </Link>
          .
        </p>
      </div>
    </main>
  );
}

export function LegalSection({
  heading,
  children
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-24 text-ink">{heading}</h2>
      <div className="flex flex-col gap-3 text-15 leading-relaxed text-ink-2">
        {children}
      </div>
    </section>
  );
}
