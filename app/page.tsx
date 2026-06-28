import { Printer, QrCode, Store } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/app/components/brand/logo";
import { SiteFooter } from "@/app/components/site-footer";
import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { EmptyState } from "@/app/components/ui/empty-state";
import { Receipt } from "@/app/components/ui/receipt";
import { Stamp } from "@/app/components/ui/stamp";

const receiptLines = [
  { label: "2 x Brown butter cookies", value: "$24.00" },
  { label: "1 x Sourdough loaf", value: "$10.00" }
];

export default function Home() {
  return (
    <main className="min-h-screen bg-paper px-4 py-8 text-ink sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Logo variant="wordmark" size={44} />
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/api/health">Health</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/signup">
                <QrCode aria-hidden="true" />
                Open your stoop
              </Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col justify-center gap-6">
            <div className="space-y-4">
              <Stamp status="new">Phase 1 foundation</Stamp>
              <h1 className="ab-display-lg max-w-3xl">
                Set up your stoop in minutes. Take orders, not DMs.
              </h1>
              <p className="ab-body max-w-2xl text-ink-2">
                The foundation is ready for the seller dashboard, QR storefront,
                payments, email, and building bazaars. Product screens come in
                later phases; this page proves the Stoop kit is wired.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/signup">
                  <Store aria-hidden="true" />
                  Start setup
                </Link>
              </Button>
              <Button variant="secondary">
                <Printer aria-hidden="true" />
                Print your QR
              </Button>
            </div>
          </div>

          <Card className="grid gap-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="ab-eyebrow">Kit primitive check</p>
                <h2 className="ab-h2 mt-2">Buttons, stamps, receipts</h2>
              </div>
              <Stamp status="accepted">Ready</Stamp>
            </div>
            <Receipt
              title="Priya's Kitchen"
              number="#2014"
              lines={receiptLines}
              total="$34.00"
              meta="Paid - Stripe - Mar 14, 3:42 PM"
            />
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <p className="ab-eyebrow">Runtime</p>
            <p className="ab-h3 mt-3">Next.js App Router</p>
            <p className="ab-body-sm mt-2">
              Strict TypeScript, Tailwind token utilities, route handlers, and
              server actions are ready.
            </p>
          </Card>
          <Card>
            <p className="ab-eyebrow">Cloudflare</p>
            <p className="ab-h3 mt-3">Pages smoke plus OpenNext</p>
            <p className="ab-body-sm mt-2">
              Static headers are present, and Wrangler can run the full app in
              the Worker runtime.
            </p>
          </Card>
          <Card>
            <p className="ab-eyebrow">Verification</p>
            <p className="ab-h3 mt-3">One command gate</p>
            <p className="ab-body-sm mt-2">
              Run <span className="font-mono">npm run verify</span> before
              calling a phase complete.
            </p>
          </Card>
        </section>

        <EmptyState
          icon={QrCode}
          title="No orders yet"
          body="Print your QR and stick it somewhere people walk past."
          action={<Button variant="ink" size="sm">Download QR poster</Button>}
        />
      </div>
      <SiteFooter />
    </main>
  );
}
