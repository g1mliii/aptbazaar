"use client";

import { useId, useState, useTransition } from "react";

import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Checkbox, Input } from "@/app/components/ui/form";
import { startSignup, type SignupFieldErrors } from "@/lib/actions/signup";
import type { PickupMethod } from "@/lib/schemas/store";
import { cn } from "@/lib/utils/cn";
import { parsePriceToCents } from "@/lib/utils/price";
import { slugify } from "@/lib/utils/slug";

// The canonical responsibility copy lives in IMPLEMENTATION_PLAN.md's voice cheat sheet
// (single source of truth — Phase 3.1 step 6 reads it verbatim).
const RESPONSIBILITY_COPY =
  "I'm responsible for following local laws, building rules, food safety, allergen disclosure, and collecting and remitting any sales tax I owe. Stoop doesn't moderate compliance and doesn't file taxes for me.";

type PickupChoice = {
  value: PickupMethod;
  title: string;
  body: string;
  posterLabel: string;
};

const PICKUP_CHOICES: PickupChoice[] = [
  {
    value: "message_after_order",
    title: "Message after order",
    body: "Share exact details privately.",
    posterLabel: "Message after order"
  },
  {
    value: "lobby_pickup",
    title: "Lobby / front desk",
    body: "Keep the public copy unit-free.",
    posterLabel: "Lobby pickup"
  },
  {
    value: "scheduled_window",
    title: "Set a pickup window",
    body: "Show a simple time on the shop.",
    posterLabel: "Pickup window"
  }
];

export function SignupForm() {
  const formId = useId();
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [itemName, setItemName] = useState("");
  const [price, setPrice] = useState("");
  const [pickup, setPickup] = useState<PickupMethod>("message_after_order");
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<SignupFieldErrors>({});
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activePoster = PICKUP_CHOICES.find((c) => c.value === pickup);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    startTransition(async () => {
      const result = await startSignup({
        storeName,
        email,
        itemName,
        priceCents: parsePriceToCents(price),
        pickupMethod: pickup,
        responsibilityAccepted: accepted
      });
      if (result.ok) {
        setSentMessage(result.message);
      } else {
        setErrors(result.fieldErrors);
      }
    });
  }

  if (sentMessage) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="font-mono text-12 uppercase tracking-[0.12em] text-verdigris">
          Almost there
        </p>
        <h1 className="mt-2 font-display text-28 text-ink">Check your email</h1>
        <p className="mt-3 text-15 text-ink-2">{sentMessage}</p>
        <p className="mt-4 text-13 text-ink-3">
          The link opens your stoop and takes you straight to your QR poster. You can
          close this tab.
        </p>
      </Card>
    );
  }

  return (
    <form
      className="mx-auto grid w-full max-w-4xl gap-6 lg:grid-cols-[1fr_minmax(0,340px)]"
      onSubmit={handleSubmit}
      noValidate
    >
      <Card aria-labelledby={`${formId}-title`}>
        <p className="font-mono text-12 uppercase tracking-[0.12em] text-verdigris">
          Quick start
        </p>
        <h1 id={`${formId}-title`} className="mt-2 font-display text-36 text-ink">
          Open your stoop
        </h1>
        <p className="mt-2 text-15 text-ink-2">
          Add the basics now. Photos, Stripe, building visibility, and the rest can wait
          until your QR is ready.
        </p>

        <div className="mt-6 flex flex-col gap-5">
          <Field
            id={`${formId}-store-name`}
            label="Store name"
            error={errors.storeName}
          >
            <Input
              id={`${formId}-store-name`}
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Priya's Kitchen"
              autoComplete="organization"
              aria-invalid={Boolean(errors.storeName)}
            />
          </Field>

          <Field id={`${formId}-email`} label="Your email" error={errors.email}>
            <Input
              id={`${formId}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
            />
            <p className="mt-1 text-13 text-ink-3">
              We&apos;ll send a link to finish setup — no password to remember.
            </p>
          </Field>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field
              id={`${formId}-item-name`}
              label="First item"
              error={errors.itemName}
            >
              <Input
                id={`${formId}-item-name`}
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="Brown butter cookies"
                aria-invalid={Boolean(errors.itemName)}
              />
            </Field>
            <Field id={`${formId}-price`} label="Price" error={errors.priceCents}>
              <Input
                id={`${formId}-price`}
                numeric
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="$12"
                className="sm:w-28"
                aria-invalid={Boolean(errors.priceCents)}
              />
            </Field>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-14 font-semibold text-ink">
              Pickup method
            </legend>
            {PICKUP_CHOICES.map((choice) => {
              const active = pickup === choice.value;
              return (
                <label
                  key={choice.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border bg-surface px-4 py-3 transition-[border-color,background-color] duration-fast ease-stoop",
                    active
                      ? "border-verdigris bg-verdigris-3"
                      : "border-line hover:border-line-strong"
                  )}
                >
                  <input
                    type="radio"
                    name={`${formId}-pickup`}
                    value={choice.value}
                    checked={active}
                    onChange={() => setPickup(choice.value)}
                    className="h-4 w-4 accent-verdigris"
                  />
                  <span className="flex flex-col">
                    <span className="text-14 font-semibold text-ink">
                      {choice.title}
                    </span>
                    <span className="text-13 text-ink-3">{choice.body}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <label className="flex items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              aria-invalid={Boolean(errors.responsibilityAccepted)}
            />
            <span className="text-13 text-ink-2">{RESPONSIBILITY_COPY}</span>
          </label>
          {errors.responsibilityAccepted ? (
            <p className="-mt-2 text-13 text-danger">{errors.responsibilityAccepted}</p>
          ) : null}
          <p className="text-13 text-ink-3">
            Opening your stoop means you agree to our{" "}
            <a href="/terms" className="font-semibold text-verdigris">
              terms
            </a>{" "}
            and{" "}
            <a href="/privacy" className="font-semibold text-verdigris">
              privacy policy
            </a>
            .
          </p>
        </div>

        <Button type="submit" size="lg" className="mt-6 w-full" disabled={isPending}>
          {isPending ? "Opening your stoop…" : "Open your stoop"}
        </Button>
      </Card>

      <aside aria-label="QR poster preview" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between text-13 text-ink-3">
          <span>Next</span>
          <b className="font-semibold text-ink-2">Print your QR poster</b>
        </div>
        <Card className="flex flex-col items-center gap-4 text-center">
          <div>
            <p className="font-display text-24 text-ink">{storeName || "Your stoop"}</p>
            <p className="text-13 text-ink-3">{activePoster?.posterLabel}</p>
          </div>
          <div className="flex h-44 w-44 items-center justify-center rounded-md border border-dashed border-line bg-paper-2 text-ink-3">
            <span className="font-mono text-12 uppercase tracking-[0.12em]">
              QR preview
            </span>
          </div>
          <p className="text-14 font-semibold text-ink">Scan to order</p>
          <p className="font-mono text-12 text-ink-3">
            stoop.shop/{slugify(storeName)}
          </p>
        </Card>
        <div className="flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3">
          <span className="text-14 text-ink-2">{itemName || "First item"}</span>
          <b className="font-mono text-14 font-semibold text-ink">{price || "$0"}</b>
        </div>
      </aside>
    </form>
  );
}

function Field({
  children,
  error,
  id,
  label
}: {
  children: React.ReactNode;
  error?: string;
  id: string;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-14 font-semibold text-ink">
        {label}
      </label>
      {children}
      {error ? <p className="text-13 text-danger">{error}</p> : null}
    </div>
  );
}
