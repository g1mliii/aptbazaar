import { StoreHeader } from "@/app/components/storefront/store-header";
import { SubscribeForm } from "@/app/components/storefront/subscribe-form";
import type { StorefrontStore } from "@/app/components/storefront/types";
import { EmptyState } from "@/app/components/ui/empty-state";

// Phase 4.8: a deactivated store still resolves (it exists), so we show its header and a
// neighborly closed notice rather than a 404. Voice cheat sheet copy.
// "booked" is the same shell for a store that's open but hit its per-day order cap — it reopens on
// its own tomorrow, so the copy points at "tomorrow" rather than "soon".

type StoreClosedVariant = "closed" | "booked";

const COPY: Record<StoreClosedVariant, { title: string; body: string; prompt: string }> = {
  closed: {
    title: "Stoop's closed today.",
    body: "Check back soon.",
    prompt: "Subscribe to hear when this stoop opens back up."
  },
  booked: {
    title: "Fully booked for today.",
    body: "Check back tomorrow.",
    prompt: "Subscribe to hear when this stoop has room again."
  }
};

export function StoreClosed({
  store,
  variant = "closed"
}: {
  store: StorefrontStore;
  variant?: StoreClosedVariant;
}) {
  const copy = COPY[variant];
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-12 pt-4">
      <StoreHeader open={false} store={store} />
      <div className="mt-4">
        <EmptyState body={copy.body} title={copy.title} />
      </div>
      <div className="mt-6">
        <SubscribeForm prompt={copy.prompt} storeId={store.id} />
      </div>
    </main>
  );
}
