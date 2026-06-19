import { EmptyState } from "@/app/components/ui/empty-state";

// Phase 4.6: unknown tracking token. Neighbor tone, no error code.
export default function OrderTrackingNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md items-center px-4">
      <EmptyState
        body="We couldn't find an order for this link. Double-check it, or look for the link in your confirmation email."
        className="w-full"
        title="We couldn't find that order."
      />
    </main>
  );
}
