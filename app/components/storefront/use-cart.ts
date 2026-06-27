"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { StorefrontProduct } from "./types";

// Phase 4.2: client-only cart. No DB until placement. Persisted to sessionStorage so a refresh
// keeps the cart, but it never outlives the tab — and the placement flow wipes it before any
// redirect (Phase 4.4a) so hitting Back from checkout can't double-order.

type CartCounts = Record<string, number>;

export type CartLine = {
  product: StorefrontProduct;
  qty: number;
};

const CART_STORAGE_VERSION = "v1";

function storageKey(slug: string): string {
  return `stoop.cart.${CART_STORAGE_VERSION}.${slug}`;
}

// A product's purchasable ceiling: the tighter of total stock (qty_available) and the per-order
// cap (max_per_order). Either being null means "no limit from that side"; the cart honors both.
function maxQty(product: StorefrontProduct): number {
  return Math.min(
    product.qty_available ?? Number.POSITIVE_INFINITY,
    product.max_per_order ?? Number.POSITIVE_INFINITY
  );
}

export function useCart(slug: string, products: StorefrontProduct[]) {
  const byId = useMemo(() => {
    const map = new Map<string, StorefrontProduct>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const [counts, setCounts] = useState<CartCounts>({});
  // Ref, not state: gates the save effect so it can't blank storage before the load runs,
  // without itself being an in-effect setState.
  const hydratedRef = useRef(false);

  // Load once on mount — deliberately post-mount, not in a lazy initializer, so the server-
  // rendered markup (empty cart) matches the first client render and only then fills from
  // sessionStorage (no hydration mismatch). Drop any line whose product is gone or sold out so
  // a stale cart can't resurrect an unavailable item.
  useEffect(() => {
    let cleaned: CartCounts = {};
    try {
      const raw = sessionStorage.getItem(storageKey(slug));
      const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      for (const [id, qty] of Object.entries(parsed)) {
        const product = byId.get(id);
        if (!product || typeof qty !== "number" || qty <= 0) continue;
        cleaned[id] = Math.min(qty, maxQty(product));
      }
    } catch {
      cleaned = {};
    }
    hydratedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe: persisted cart is read from sessionStorage only after mount
    setCounts(cleaned);
  }, [slug, byId]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      sessionStorage.setItem(storageKey(slug), JSON.stringify(counts));
    } catch {
      // Private-mode / quota failures are non-fatal: the cart just won't survive a refresh.
    }
  }, [counts, slug]);

  // Functional update so rapid successive taps compose correctly (each reads the latest count
  // from the updater's `prev`, not a render-time closure). Clamps to [0, qty_available].
  const adjust = useCallback(
    (productId: string, delta: number) => {
      const product = byId.get(productId);
      if (!product) return;
      setCounts((prev) => {
        const clamped = Math.max(
          0,
          Math.min((prev[productId] ?? 0) + delta, maxQty(product))
        );
        const next = { ...prev };
        if (clamped <= 0) {
          delete next[productId];
        } else {
          next[productId] = clamped;
        }
        return next;
      });
    },
    [byId]
  );

  const add = useCallback((productId: string) => adjust(productId, 1), [adjust]);
  const inc = add;
  const dec = useCallback((productId: string) => adjust(productId, -1), [adjust]);

  const clear = useCallback(() => setCounts({}), []);

  const lines: CartLine[] = useMemo(() => {
    const result: CartLine[] = [];
    for (const [id, qty] of Object.entries(counts)) {
      const product = byId.get(id);
      if (product) result.push({ product, qty });
    }
    return result;
  }, [counts, byId]);

  const subtotalCents = useMemo(
    () => lines.reduce((sum, l) => sum + l.product.price_cents * l.qty, 0),
    [lines]
  );

  const itemCount = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);

  return {
    counts,
    lines,
    subtotalCents,
    itemCount,
    qtyOf: (id: string) => counts[id] ?? 0,
    add,
    inc,
    dec,
    clear
  };
}
