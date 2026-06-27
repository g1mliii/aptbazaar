"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Checkbox, Input } from "@/app/components/ui/form";
import { subscribe } from "@/lib/actions/subscribers";

import { TurnstileWidget, type TurnstileHandle } from "./turnstile-widget";

// Phase 4.10: subscriber capture. Matches SubscribeForm.jsx. Email + required consent only —
// no phone / SMS in v1. One-tap, no account.

export function SubscribeForm({
  storeId,
  prompt
}: {
  storeId: string;
  prompt?: string;
}) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await subscribe({
        storeId,
        email: email.trim(),
        consentEmail: consent,
        turnstileToken: turnstileToken ?? undefined
      });
      if (result.ok) {
        setDone(true);
        return;
      }
      // The single-use Turnstile token was consumed server-side; re-issue one so a retry isn't
      // blocked by the already-redeemed token.
      turnstileRef.current?.reset();
      setError(
        result.error ??
          Object.values(result.fieldErrors ?? {})[0] ??
          "We couldn't add you just now. Try again in a moment."
      );
    });
  }

  return (
    <Card>
      <h2 className="ab-h2 text-ink">Hear about the next drop</h2>
      <p className="ab-body-sm mt-1 text-ink-2">
        {prompt ?? "Get a heads up the next time something's available."}
      </p>

      {done ? (
        <p
          aria-live="polite"
          className="mt-3 font-sans text-13 font-semibold text-success"
          role="status"
        >
          You&apos;re on the list.
        </p>
      ) : (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Email address</span>
              <Input
                autoComplete="email"
                name="subscriberEmail"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                spellCheck={false}
                type="email"
                value={email}
              />
            </label>
            <Button disabled={pending} type="submit" variant="ink">
              Notify me
            </Button>
          </div>
          <label className="flex items-start gap-2">
            <Checkbox
              checked={consent}
              className="mt-0.5"
              name="emailConsent"
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span className="ab-caption text-ink-3">
              Email me about new drops. You can unsubscribe any time — one tap, no
              account.
            </span>
          </label>
          <TurnstileWidget onToken={setTurnstileToken} ref={turnstileRef} />
          {error ? (
            <p aria-live="polite" className="ab-caption text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </Card>
  );
}
