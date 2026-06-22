"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Logo } from "@/app/components/brand/logo";
import { SellerPreviewBar } from "@/app/s/[slug]/preview-bar";
import { CartDrawer } from "@/app/components/storefront/cart-drawer";
import { CheckoutForm } from "@/app/components/storefront/checkout-form";
import { ProductCard } from "@/app/components/storefront/product-card";
import { StoreHeader } from "@/app/components/storefront/store-header";
import { SubscribeForm } from "@/app/components/storefront/subscribe-form";
import type {
  StorefrontProduct,
  StorefrontStore
} from "@/app/components/storefront/types";
import { useCart } from "@/app/components/storefront/use-cart";
import { ScanBeacon } from "@/app/s/[slug]/scan-beacon";
import { formatMoney } from "@/lib/pricing/currency";

type View = "shop" | "cart" | "checkout";

export function Storefront({
  store,
  products,
  onlineReady
}: {
  store: StorefrontStore;
  products: StorefrontProduct[];
  onlineReady: boolean;
}) {
  const router = useRouter();
  const cart = useCart(store.slug, products);
  const [view, setView] = useState<View>("shop");

  const allSoldOut =
    products.length > 0 && products.every((p) => p.qty_available === 0);

  function handlePlaced(token: string) {
    cart.clear();
    router.push(`/o/${token}`);
  }

  function handleRedirect(url: string) {
    // Online order: clear the cart before handing off to Stripe Checkout so a Back from Stripe
    // re-mounts an empty cart (Phase 4.4a — prevents accidental double-orders).
    cart.clear();
    window.location.href = url;
  }

  return (
    <>
      <ScanBeacon storeId={store.id} />
      <SellerPreviewBar storeId={store.id} />
      <main className="mx-auto w-full max-w-md px-4 pb-28 pt-4">
        <StoreHeader store={store} />

        <div className="mt-4 grid grid-cols-2 gap-3">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              onAdd={() => cart.add(product.id)}
              onDec={() => cart.dec(product.id)}
              onInc={() => cart.inc(product.id)}
              product={product}
              qty={cart.qtyOf(product.id)}
            />
          ))}
        </div>

        <div className="mt-6">
          <SubscribeForm
            prompt={
              allSoldOut
                ? "All gone for today. Subscribe to hear about the next drop."
                : undefined
            }
            storeId={store.id}
          />
        </div>

        <footer className="mt-10 border-t border-line pt-6 text-center">
          <Link
            aria-label="Stoop home"
            className="inline-flex items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
            href="/"
          >
            <Logo size={26} variant="wordmark" />
          </Link>
          <p className="ab-caption mt-2 text-ink-3">Powered by Stoop</p>
        </footer>

        {cart.itemCount > 0 && view === "shop" ? (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface p-3">
            <div className="mx-auto flex max-w-md items-center justify-between gap-3">
              <span className="font-mono text-14 tabular-nums text-ink">
                {cart.itemCount} {cart.itemCount === 1 ? "item" : "items"} ·{" "}
                {formatMoney(cart.subtotalCents)}
              </span>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md bg-verdigris px-5 font-sans text-15 font-semibold text-surface shadow-sm transition-transform duration-fast ease-stoop hover:bg-verdigris-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris active:translate-y-px active:shadow-none"
                onClick={() => setView("cart")}
                type="button"
              >
                <ShoppingBag aria-hidden="true" className="h-5 w-5 stroke-[1.5]" />
                View cart
              </button>
            </div>
          </div>
        ) : null}

        <CartDrawer
          lines={cart.lines}
          onCheckout={() => setView("checkout")}
          onClose={() => setView("shop")}
          onDec={cart.dec}
          onInc={cart.inc}
          open={view === "cart"}
          subtotalCents={cart.subtotalCents}
        />

        <CheckoutForm
          lines={cart.lines}
          onBack={() => setView("cart")}
          onPlaced={handlePlaced}
          onRedirect={handleRedirect}
          onlineReady={onlineReady}
          open={view === "checkout"}
          store={store}
          subtotalCents={cart.subtotalCents}
        />
      </main>
    </>
  );
}
