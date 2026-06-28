"use client";

import { useId, useState, useTransition } from "react";

import { Button } from "@/app/components/ui/button";
import { Card } from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/form";
import { submitAdminLogin } from "@/lib/actions/admin";

export function AdminLoginForm() {
  const fieldId = useId();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await submitAdminLogin(secret);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <p className="font-mono text-12 uppercase tracking-[0.12em] text-verdigris">
        Founder access
      </p>
      <h1 className="mt-2 font-display text-28 text-ink">Enter your key</h1>
      <p className="mt-2 text-15 text-ink-2">
        This page is for the founder. If you landed here by accident, you can close the
        tab.
      </p>

      {error ? (
        <p className="mt-4 rounded-md border border-warning bg-warning-3 px-4 py-3 text-14 text-ink">
          {error}
        </p>
      ) : null}

      <form className="mt-5 flex flex-col gap-3" onSubmit={handleSubmit} noValidate>
        <label htmlFor={fieldId} className="text-14 font-semibold text-ink">
          Access key
        </label>
        <Input
          id={fieldId}
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="off"
          required
        />
        <Button type="submit" size="lg" className="w-full" disabled={isPending}>
          {isPending ? "Checking…" : "Open the dashboard"}
        </Button>
      </form>
    </Card>
  );
}
