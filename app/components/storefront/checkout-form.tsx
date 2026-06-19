"use client";

import { ArrowLeft } from "lucide-react";
import { useId, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/app/components/ui/button";
import { Drawer } from "@/app/components/ui/drawer";
import { Input, Textarea } from "@/app/components/ui/form";
import { Toast } from "@/app/components/ui/toast";
import { placeOrder } from "@/lib/actions/orders";
import { pickupOptionsFor } from "@/lib/orders/pickup";
import { cn } from "@/lib/utils/cn";
import { formatPriceCents } from "@/lib/utils/price";

import type { CartLine } from "./use-cart";
import type { StorefrontStore } from "./types";

// Phase 4.3: order placement form. Matches CheckoutForm.jsx. A UUIDv4 idempotency key is minted
// once on mount and reused across retries from this form instance, so a double-tap on flaky
// mobile data can't create two orders (it replays to the same row in place_order).
//
// Phase 4 has no Stripe, so every order is pay-at-pickup. The payment-mode radio only renders
// once a store has BOTH modes available (online connected + accept_pay_at_pickup) — Phase 5
// wires that. Until then the submit reads "Place order".

type CheckoutFormProps = {
  open: boolean;
  store: StorefrontStore;
  lines: CartLine[];
  subtotalCents: number;
  onBack: () => void;
  onPlaced: (token: string) => void;
};

export function CheckoutForm({
  open,
  store,
  lines,
  subtotalCents,
  onBack,
  onPlaced
}: CheckoutFormProps) {
  const pickupOptions = useMemo(() => pickupOptionsFor(store), [store]);
  const emailHelpId = useId();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pickup, setPickup] = useState(pickupOptions[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The idempotency key tracks the order *body* (the fields place_order hashes: store, email,
  // payment mode, items), not the form's lifetime. A true double-tap of the same order reuses the
  // key and replays to the same row; editing the cart or fixing the email after a believed-failed
  // submit mints a fresh key, so the retry places a new order instead of dead-ending on STP01
  // ("refresh and start over"). crypto.randomUUID is available in every target browser.
  const bodySignature = useMemo(
    () =>
      JSON.stringify({
        storeId: store.id,
        email: email.trim().toLowerCase(),
        items: lines
          .map((l) => [l.product.id, l.qty] as const)
          .sort(([a], [b]) => a.localeCompare(b))
      }),
    [store.id, email, lines]
  );
  const idempotencyRef = useRef<{ sig: string; key: string } | null>(null);

  function submit() {
    setError(null);
    const customerName = name.trim();
    const customerEmail = email.trim();
    if (lines.length === 0) {
      setError("Your cart is empty.");
      return;
    }
    if (!customerName) {
      setError("Tell us who to look out for.");
      return;
    }
    if (!/.+@.+\..+/.test(customerEmail)) {
      setError("Add an email so we can send your tracking link.");
      return;
    }

    if (idempotencyRef.current?.sig !== bodySignature) {
      idempotencyRef.current = { sig: bodySignature, key: crypto.randomUUID() };
    }
    const idempotencyKey = idempotencyRef.current.key;

    startTransition(async () => {
      // Strip the spaces/dashes/parens people naturally type (and that the placeholder shows) so a
      // number like "+1 416 555 0140" still satisfies the strict E.164 schema instead of being
      // rejected at submit.
      const normalizedPhone = phone.replace(/[\s().-]/g, "");
      const result = await placeOrder({
        storeId: store.id,
        customerName,
        customerEmail,
        customerPhoneE164: normalizedPhone ? normalizedPhone : undefined,
        paymentMode: "pay_at_pickup",
        pickupWindow: pickup || undefined,
        notes: notes.trim() ? notes.trim() : undefined,
        idempotencyKey,
        items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty }))
      });

      if (result.ok) {
        onPlaced(result.token);
        return;
      }
      setError(
        result.error ??
          Object.values(result.fieldErrors ?? {})[0] ??
          "We couldn't place your order. Try again in a moment."
      );
    });
  }

  return (
    <Drawer open={open} side="bottom" title="Checkout" className="pt-5">
      <button
        aria-label="Back to cart"
        className="absolute left-5 top-5 text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft aria-hidden="true" className="h-5 w-5 stroke-[1.5]" />
      </button>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="block">
          <span className="ab-label mb-1 block text-ink">Your name</span>
          <Input
            autoComplete="name"
            name="customerName"
            onChange={(e) => setName(e.target.value)}
            placeholder="Priya M."
            value={name}
          />
        </label>

        <label className="block">
          <span className="ab-label mb-1 block text-ink">Email</span>
          <Input
            aria-describedby={emailHelpId}
            autoComplete="email"
            name="customerEmail"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            spellCheck={false}
            type="email"
            value={email}
          />
          <span className="ab-caption mt-1 block text-ink-3" id={emailHelpId}>
            We&apos;ll send your order confirmation here.
          </span>
        </label>

        <label className="block">
          <span className="ab-label mb-1 block text-ink">Phone (optional)</span>
          <Input
            autoComplete="tel"
            inputMode="tel"
            name="customerPhone"
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 416 555 0140"
            type="tel"
            value={phone}
          />
        </label>

        {pickupOptions.length > 0 ? (
          <div>
            <span className="ab-label mb-1 block text-ink">Pickup</span>
            <div aria-label="Pickup" className="grid gap-2" role="radiogroup">
              {pickupOptions.map((option) => (
                <label
                  className={cn(
                    "cursor-pointer rounded-sm border px-4 py-2 text-left font-sans text-14 transition-colors duration-fast ease-stoop focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-verdigris",
                    pickup === option
                      ? "border-verdigris bg-verdigris-3 text-ink"
                      : "border-line bg-surface text-ink-2 hover:bg-paper-2"
                  )}
                  key={option}
                >
                  <input
                    checked={pickup === option}
                    className="sr-only"
                    name="pickupWindow"
                    onChange={() => setPickup(option)}
                    type="radio"
                    value={option}
                  />
                  {option}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <label className="block">
          <span className="ab-label mb-1 block text-ink">Notes for {store.name}</span>
          <Textarea
            name="notes"
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything they should know?"
            value={notes}
          />
        </label>

        <div className="flex justify-between border-t border-dashed border-line pt-4 font-mono text-15 font-bold tabular-nums text-ink">
          <span>TOTAL</span>
          <span>{formatPriceCents(subtotalCents)}</span>
        </div>

        <p className="ab-caption text-ink-3">
          By placing this order, you agree to pick up at the location the seller shares
          after checkout. You&apos;ll pay at pickup.
        </p>

        {error ? (
          <Toast className="w-full justify-center" tone="danger">
            {error}
          </Toast>
        ) : null}

        <Button
          className="w-full"
          disabled={pending}
          size="lg"
          type="submit"
          variant="primary"
        >
          {pending ? "Placing your order…" : "Place order"}
        </Button>
      </form>
    </Drawer>
  );
}
