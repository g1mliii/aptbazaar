import { StoreHeader } from "@/app/components/storefront/store-header";
import { SubscribeForm } from "@/app/components/storefront/subscribe-form";
import type { StorefrontStore } from "@/app/components/storefront/types";
import { EmptyState } from "@/app/components/ui/empty-state";

// Phase 4.8: a deactivated store still resolves (it exists), so we show its header and a
// neighborly closed notice rather than a 404. Voice cheat sheet copy.

export function StoreClosed({ store }: { store: StorefrontStore }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-12 pt-4">
      <StoreHeader open={false} store={store} />
      <div className="mt-4">
        <EmptyState
          body="Check back soon."
          title="Stoop's closed today."
        />
      </div>
      <div className="mt-6">
        <SubscribeForm
          prompt="Subscribe to hear when this stoop opens back up."
          storeId={store.id}
        />
      </div>
    </main>
  );
}
