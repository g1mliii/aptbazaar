"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/app/components/ui/button";
import { Drawer } from "@/app/components/ui/drawer";
import { Input, Textarea } from "@/app/components/ui/form";
import { Toast } from "@/app/components/ui/toast";
import { placeOrder } from "@/lib/actions/orders";
import { pickupOptionsFor } from "@/lib/orders/pickup";
import type { PaymentMode } from "@/lib/schemas/order";
import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/pricing/currency";

import { TurnstileWidget, type TurnstileHandle } from "./turnstile-widget";
import type { CartLine } from "./use-cart";
import type { StorefrontStore } from "./types";

// Coerce a naturally-typed phone number into E.164 so the customer doesn't have to know the
// "+14155550100" format. v1 is Canada-only (+1), so a bare 10-digit number gets +1; a leading 1
// or an explicit + is respected. Empty stays empty (the field is optional).
function toE164(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

// Phase 4.3 / 5.5: order placement form. Matches CheckoutForm.jsx. A UUIDv4 idempotency key is
// minted once on mount and reused across retries from this form instance, so a double-tap on flaky
// mobile data can't create two orders (it replays to the same row in place_order).
//
// The payment-mode radio renders only when the store has BOTH modes (online connected +
// accept_pay_at_pickup). With one mode the radio is hidden and the submit label reflects it:
// "Pay & order" (online) vs "Place order" (pay-at-pickup). Online submits redirect to Stripe.

type CheckoutFormProps = {
  open: boolean;
  store: StorefrontStore;
  onlineReady: boolean;
  lines: CartLine[];
  subtotalCents: number;
  onBack: () => void;
  onPlaced: (token: string) => void;
  onRedirect: (url: string) => void;
};

export function CheckoutForm({
  open,
  store,
  onlineReady,
  lines,
  subtotalCents,
  onBack,
  onPlaced,
  onRedirect
}: CheckoutFormProps) {
  const pickupOptions = useMemo(() => pickupOptionsFor(store), [store]);
  const emailHelpId = useId();

  const canPickup = store.accept_pay_at_pickup;
  const bothModes = onlineReady && canPickup;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [pickup, setPickup] = useState(pickupOptions[0] ?? "");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(
    onlineReady ? "online" : "pay_at_pickup"
  );
  // An all-$0 cart is a giveaway: there's nothing to pay, so it skips Stripe and the pay-at-pickup
  // gate entirely and settles on placement. We force mode 'free' and hide the payment chooser.
  const isFree = subtotalCents === 0;
  const effectiveMode: PaymentMode = isFree ? "free" : paymentMode;
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
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
        paymentMode: effectiveMode,
        items: lines
          .map((l) => [l.product.id, l.qty] as const)
          .sort(([a], [b]) => a.localeCompare(b))
      }),
    [store.id, email, effectiveMode, lines]
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
      // Accept naturally-typed numbers ("(416) 555-0140", "416 555 0140") by coercing to E.164 and
      // defaulting the country code to +1 (v1 is Canada-only), instead of rejecting at submit.
      const normalizedPhone = toE164(phone);
      const result = await placeOrder({
        storeId: store.id,
        customerName,
        customerEmail,
        customerPhoneE164: normalizedPhone ? normalizedPhone : undefined,
        paymentMode: effectiveMode,
        pickupWindow: pickup || undefined,
        notes: notes.trim() ? notes.trim() : undefined,
        idempotencyKey,
        turnstileToken: turnstileToken ?? undefined,
        items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty }))
      });

      if (result.ok) {
        if ("redirectUrl" in result) {
          onRedirect(result.redirectUrl);
        } else {
          onPlaced(result.token);
        }
        return;
      }
      // The server consumed the Turnstile token (single-use) before this failure. Re-issue a fresh
      // one so a retry of a recoverable error (sold out, payment mode, checkout hiccup) isn't blocked
      // by the already-redeemed token.
      turnstileRef.current?.reset();
      setError(
        result.error ??
          Object.values(result.fieldErrors ?? {})[0] ??
          "We couldn't place your order. Try again in a moment."
      );
    });
  }

  return (
    <Drawer onBack={onBack} open={open} side="bottom" title="Checkout">
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
            placeholder="(416) 555-0140"
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

        {bothModes && !isFree ? (
          <div>
            <span className="ab-label mb-1 block text-ink">Payment</span>
            <div aria-label="Payment" className="grid gap-2" role="radiogroup">
              {(
                [
                  { value: "online", label: "Pay online" },
                  { value: "pay_at_pickup", label: "Pay at pickup" }
                ] as const
              ).map((option) => (
                <label
                  className={cn(
                    "cursor-pointer rounded-sm border px-4 py-2 text-left font-sans text-14 transition-colors duration-fast ease-stoop focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-verdigris",
                    paymentMode === option.value
                      ? "border-verdigris bg-verdigris-3 text-ink"
                      : "border-line bg-surface text-ink-2 hover:bg-paper-2"
                  )}
                  key={option.value}
                >
                  <input
                    checked={paymentMode === option.value}
                    className="sr-only"
                    name="paymentMode"
                    onChange={() => setPaymentMode(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex justify-between border-t border-dashed border-line pt-4 font-mono text-15 font-bold tabular-nums text-ink">
          <span>TOTAL</span>
          <span>{formatPrice(subtotalCents)}</span>
        </div>

        <p className="ab-caption text-ink-3">
          {isFree
            ? "This one's on the house. Claim it and the seller shares pickup details after."
            : effectiveMode === "online"
              ? "You'll pay securely by card on the next screen. The seller shares pickup details after your order."
              : "By placing this order, you agree to pick up at the location the seller shares after checkout. You'll pay at pickup."}
        </p>

        <TurnstileWidget onToken={setTurnstileToken} ref={turnstileRef} />

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
          {(() => {
            const [idleLabel, pendingLabel] = isFree
              ? ["Claim", "Claiming…"]
              : effectiveMode === "online"
                ? ["Pay & order", "Sending you to checkout…"]
                : ["Place order", "Placing your order…"];
            return pending ? pendingLabel : idleLabel;
          })()}
        </Button>
      </form>
    </Drawer>
  );
}
