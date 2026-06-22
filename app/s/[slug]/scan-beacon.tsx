"use client";

import { useEffect } from "react";

import { SCAN_SRC_FALLBACK } from "@/lib/schemas/scan";

// Phase 7.4: the storefront scan pixel. The ?src= channel tag is read client-side on purpose — the
// server page stays cacheable (it never sees searchParams). We fire the beacon imperatively via an
// Image request on mount (once), which avoids both an SSR/client hydration mismatch and rendering a
// throwaway element. The server route clamps and validates src; we only forward what's in the URL.
//
// Dashboard links add ?preview=1 for owner preview, so the common customer path does not need a
// server-action ownership check before the scan can be counted.
export function ScanBeacon({ storeId }: { storeId: string }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("preview") === "1") {
      return;
    }
    const channel = params.get("src") ?? SCAN_SRC_FALLBACK;
    const beacon = new Image();
    beacon.src = `/api/scan?store=${encodeURIComponent(storeId)}&src=${encodeURIComponent(channel)}`;
  }, [storeId]);

  return null;
}
