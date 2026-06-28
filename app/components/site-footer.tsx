import Link from "next/link";

// Phase 10.5: the one place public chrome links to the legal pages. Minimal and token-styled — no
// new colors or spacing. Rendered on the home and signup surfaces; a richer footer can grow here
// later if the marketing site needs one.
export function SiteFooter() {
  return (
    <footer className="mx-auto mt-10 flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 text-13 text-ink-3">
      <span>© Stoop</span>
      <Link href="/privacy" className="font-semibold text-ink-2 hover:text-verdigris">
        Privacy
      </Link>
      <Link href="/terms" className="font-semibold text-ink-2 hover:text-verdigris">
        Terms
      </Link>
    </footer>
  );
}
