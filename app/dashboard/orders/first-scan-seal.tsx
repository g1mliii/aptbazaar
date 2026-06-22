"use client";

import { useEffect } from "react";

import { Seal } from "@/app/components/ui/seal";
import { markFirstScanSeen } from "@/lib/actions/nudge";

// Phase 7.5: the first-scan ceremony. Rendered only when the store has a first scan the seller
// hasn't seen yet; on mount it records that it's been seen so it fires exactly once (no SSE, no
// re-fire on the next load). The seal is reserved for genuine milestones — this is one.
export function FirstScanSeal({ storeId }: { storeId: string }) {
  useEffect(() => {
    void markFirstScanSeen(storeId);
  }, [storeId]);

  return (
    <div className="mb-4 flex items-center gap-4 rounded-md border border-line bg-surface px-5 py-4">
      <Seal status="paid">Scan</Seal>
      <div>
        <p className="font-display text-20 text-ink">Your first scan!</p>
        <p className="text-14 text-ink-2">
          Someone just scanned your QR. Orders are next — keep sharing it.
        </p>
      </div>
    </div>
  );
}
