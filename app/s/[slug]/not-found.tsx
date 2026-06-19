import { EmptyState } from "@/app/components/ui/empty-state";

// Phase 4.8: unknown slug. Voice cheat sheet copy, neighbor tone, no error code.
export default function StorefrontNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md items-center px-4">
      <EmptyState
        body="Double-check the link, or ask the seller for their QR."
        className="w-full"
        title="This stoop hasn't been set up yet."
      />
    </main>
  );
}
