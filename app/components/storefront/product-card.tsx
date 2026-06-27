"use client";

import { Minus, Plus } from "lucide-react";
import Image from "next/image";

import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/pricing/currency";

import type { StorefrontProduct } from "./types";

// Phase 4.1 / 4.9: a product tile is a typographic mini-poster — solid brand color + giant
// Instrument Serif initial (or the seller's photo when one exists). Allergens render as a mono
// caps eyebrow above the price (required for food sellers). Matches ProductCard.jsx.

// Brand-color tiles. Dark tiles take surface (white) text; marigold is light, so it takes ink.
const TILES = [
  { bg: "bg-verdigris", fg: "text-surface" },
  { bg: "bg-mulberry", fg: "text-surface" },
  { bg: "bg-teal", fg: "text-surface" },
  { bg: "bg-marigold", fg: "text-ink" },
  { bg: "bg-ink", fg: "text-surface" }
] as const;

function tileFor(id: string): (typeof TILES)[number] {
  let hash = 0;
  for (const ch of id) hash = (hash + ch.charCodeAt(0)) % TILES.length;
  return TILES[hash] ?? TILES[0];
}

type ProductCardProps = {
  product: StorefrontProduct;
  qty: number;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
};

export function ProductCard({ product, qty, onAdd, onInc, onDec }: ProductCardProps) {
  const soldOut = product.qty_available === 0;
  const tile = tileFor(product.id);
  const initial = product.name.trim().charAt(0).toUpperCase() || "S";

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
      <div className="relative aspect-square">
        {product.image_url ? (
          <Image
            alt={product.image_alt ?? product.name}
            className="object-cover"
            fill
            sizes="(max-width: 640px) 50vw, 200px"
            src={product.image_url}
          />
        ) : (
          <div
            className={cn(
              "flex h-full w-full items-center justify-center font-display",
              tile.bg,
              tile.fg
            )}
          >
            <span className="text-64 leading-none">{initial}</span>
          </div>
        )}
        {soldOut ? (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/55">
            <span className="rotate-[-3deg] rounded-xs border-2 border-surface px-3 py-1 font-sans text-12 font-extrabold uppercase tracking-[0.12em] text-surface">
              All gone
            </span>
          </div>
        ) : null}
      </div>

      <div className="p-3">
        <div className="ab-h3 text-ink">{product.name}</div>
        {product.allergens.length > 0 ? (
          <div className="ab-eyebrow mt-1 text-ink-3">
            Contains: {product.allergens.join(", ")}
          </div>
        ) : null}

        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-15 tabular-nums text-ink">
            {formatPrice(product.price_cents)}
          </span>

          {soldOut ? (
            <span className="font-mono text-12 text-ink-3">—</span>
          ) : qty > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-pill border border-line bg-paper-2 px-1">
              <button
                aria-label={`Remove one ${product.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-pill text-ink hover:bg-paper-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
                onClick={onDec}
                type="button"
              >
                <Minus aria-hidden="true" className="h-4 w-4 stroke-[1.5]" />
              </button>
              <span className="min-w-4 text-center font-mono text-14 tabular-nums text-ink">
                {qty}
              </span>
              <button
                aria-label={`Add one ${product.name}`}
                className="flex h-7 w-7 items-center justify-center rounded-pill text-ink hover:bg-paper-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
                onClick={onInc}
                type="button"
              >
                <Plus aria-hidden="true" className="h-4 w-4 stroke-[1.5]" />
              </button>
            </span>
          ) : (
            <button
              aria-label={`Add ${product.name} to cart`}
              className="flex h-9 w-9 items-center justify-center rounded-pill bg-verdigris text-surface shadow-sm transition-transform duration-fast ease-stoop hover:bg-verdigris-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris active:translate-y-px active:shadow-none"
              onClick={onAdd}
              type="button"
            >
              <Plus aria-hidden="true" className="h-5 w-5 stroke-[1.5]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
