"use client";

import { Minus, Plus, ShoppingBag, X } from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { Drawer } from "@/app/components/ui/drawer";
import { formatPriceCents } from "@/lib/utils/price";

import type { CartLine } from "./use-cart";

// Phase 4.2: slide-up cart sheet with receipt-style totals. Matches CartDrawer.jsx.
// TOTAL = subtotal: the customer never pays a platform surcharge. The 3% fee is carved from
// the seller's payout via Stripe application_fee_amount (Phase 5), shown here only as an
// informational "incl." line on online carts. Pay-at-pickup carts show subtotal alone.

type CartDrawerProps = {
  open: boolean;
  lines: CartLine[];
  subtotalCents: number;
  showPlatformFee?: boolean;
  onClose: () => void;
  onInc: (productId: string) => void;
  onDec: (productId: string) => void;
  onCheckout: () => void;
};

export function CartDrawer({
  open,
  lines,
  subtotalCents,
  showPlatformFee = false,
  onClose,
  onInc,
  onDec,
  onCheckout
}: CartDrawerProps) {
  const empty = lines.length === 0;
  const feeCents = Math.round(subtotalCents * 0.03);

  return (
    <>
      {open ? (
        <button
          aria-label="Close cart"
          className="fixed inset-0 z-30 bg-ink/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-verdigris"
          onClick={onClose}
          type="button"
        />
      ) : null}

      <Drawer open={open} side="bottom" title="Your cart" className="pt-5">
        <button
          aria-label="Close cart"
          className="absolute right-5 top-5 text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="h-5 w-5 stroke-[1.5]" />
        </button>

        {empty ? (
          <div className="py-10 text-center">
            <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-sm border border-line bg-paper-2 text-ink-3">
              <ShoppingBag aria-hidden="true" className="h-5 w-5 stroke-[1.5]" />
            </div>
            <p className="ab-body text-ink-2">Nothing in your cart yet.</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {lines.map(({ product, qty }) => (
                <div className="flex items-center gap-3" key={product.id}>
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-verdigris font-display text-20 text-surface">
                    {product.name.trim().charAt(0).toUpperCase() || "S"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="ab-label truncate text-ink">{product.name}</div>
                    <div className="font-mono text-12 tabular-nums text-ink-3">
                      {formatPriceCents(product.price_cents)} each
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-pill border border-line bg-paper-2 px-1">
                    <button
                      aria-label={`Remove one ${product.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-pill text-ink hover:bg-paper-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
                      onClick={() => onDec(product.id)}
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
                      onClick={() => onInc(product.id)}
                      type="button"
                    >
                      <Plus aria-hidden="true" className="h-4 w-4 stroke-[1.5]" />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-1 border-t border-dashed border-line pt-4 font-mono text-13 tabular-nums">
              <div className="flex justify-between text-ink-2">
                <span>Subtotal</span>
                <span>{formatPriceCents(subtotalCents)}</span>
              </div>
              {showPlatformFee ? (
                <div className="flex justify-between text-ink-3">
                  <span>Platform fee (3%)</span>
                  <span>incl. {formatPriceCents(feeCents)}</span>
                </div>
              ) : null}
              <div className="flex justify-between pt-1 text-15 font-bold text-ink">
                <span>TOTAL</span>
                <span>{formatPriceCents(subtotalCents)}</span>
              </div>
            </div>

            <Button
              className="mt-5 w-full"
              onClick={onCheckout}
              size="lg"
              variant="primary"
            >
              Checkout — {formatPriceCents(subtotalCents)}
            </Button>
          </>
        )}
      </Drawer>
    </>
  );
}
