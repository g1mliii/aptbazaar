"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { Input, Textarea } from "@/app/components/ui/form";
import { Stamp } from "@/app/components/ui/stamp";
import { Toast } from "@/app/components/ui/toast";
import {
  exportSubscribersCsv,
  removeSubscriber,
  sendDrop
} from "@/lib/actions/subscribers";

export type SubscriberRow = {
  id: string;
  email: string;
  consent_email: boolean;
  verified_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
};

type BoardProps = {
  subscribers: SubscriberRow[];
  totalSubscriberCount: number;
  activeSubscriberCount: number;
  contactAddress: string | null;
  dailyLimit: number;
  remainingToday: number;
};

type ToastState = { tone: "success" | "danger"; message: string } | null;

function isActive(s: SubscriberRow): boolean {
  return s.verified_at !== null && s.unsubscribed_at === null;
}

const JOINED_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric"
});

function formatJoined(iso: string): string {
  return JOINED_FMT.format(new Date(iso));
}

export function SubscribersBoard({
  subscribers,
  totalSubscriberCount,
  activeSubscriberCount,
  contactAddress,
  dailyLimit,
  remainingToday
}: BoardProps) {
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [toRemove, setToRemove] = useState<SubscriberRow | null>(null);
  const [composing, setComposing] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [remaining, setRemaining] = useState(remainingToday);
  const [exporting, setExporting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const showToast = (tone: "success" | "danger", message: string) =>
    setToast({ tone, message });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(
    () => subscribers.filter((s) => !removedIds.has(s.id)),
    [subscribers, removedIds]
  );
  const removedActiveCount = useMemo(
    () => subscribers.filter((s) => removedIds.has(s.id) && isActive(s)).length,
    [subscribers, removedIds]
  );
  const totalCount = Math.max(0, totalSubscriberCount - removedIds.size);
  const activeCount = Math.max(0, activeSubscriberCount - removedActiveCount);
  const listIsTruncated = totalCount > visible.length;

  function confirmRemove(subscriber: SubscriberRow) {
    setRemovedIds((prev) => new Set(prev).add(subscriber.id));
    setToRemove(null);
    startTransition(async () => {
      const res = await removeSubscriber(subscriber.id);
      if (!res.ok) {
        setRemovedIds((prev) => {
          const next = new Set(prev);
          next.delete(subscriber.id);
          return next;
        });
        showToast("danger", res.error);
      } else {
        showToast("success", "Removed.");
      }
    });
  }

  function downloadCsv(filename: string, csv: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportCsv() {
    setExporting(true);
    const res = await exportSubscribersCsv();
    setExporting(false);
    if (res.ok) {
      downloadCsv(res.filename, res.csv);
    } else {
      showToast("danger", res.error);
    }
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-36 leading-none text-ink">Subscribers</h1>
        <div className="flex-1" />
        <Button variant="secondary" disabled={exporting} onClick={exportCsv}>
          Export CSV
        </Button>
        <Button disabled={activeCount === 0} onClick={() => setComposing(true)}>
          Send a drop
        </Button>
      </div>
      <p className="mb-5 font-sans text-13 text-ink-3">
        {listIsTruncated ? (
          <>
            Showing <span className="font-mono tabular-nums">{visible.length}</span> of{" "}
            <span className="font-mono tabular-nums">{totalCount}</span> subscribers,
            all opted in from your storefront
          </>
        ) : (
          <>
            <span className="font-mono tabular-nums">{totalCount}</span> subscribers,
            all opted in from your storefront
          </>
        )}
      </p>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi
          label="Total subscribers"
          value={String(visible.length)}
          sub="on your list"
        />
        <Kpi
          label="Active"
          value={String(activeCount)}
          sub="verified, still subscribed"
          primary
        />
        <Kpi
          label="Daily send limit"
          value={`${remaining}/${dailyLimit}`}
          sub="left today"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-line bg-paper-2 px-4 py-2.5 font-sans text-12 uppercase tracking-[0.06em] text-ink-3">
          <span>Email</span>
          <span>Joined</span>
          <span>Status</span>
          <span className="sr-only">Remove</span>
        </div>
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center font-sans text-14 text-ink-3">
            Nobody on the list right now.
          </p>
        ) : (
          visible.map((s) => {
            const active = isActive(s);
            return (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
              >
                <span className="truncate font-mono text-13 text-ink">{s.email}</span>
                <span
                  className="font-mono text-13 tabular-nums text-ink-3"
                  suppressHydrationWarning
                >
                  {formatJoined(s.created_at)}
                </span>
                <Stamp status={active ? "paid" : "cancelled"}>
                  {active ? "Active" : "Unsubscribed"}
                </Stamp>
                <Button
                  aria-label={`Remove ${s.email}`}
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => setToRemove(s)}
                >
                  Remove
                </Button>
              </div>
            );
          })
        )}
      </div>

      <Dialog
        open={toRemove !== null}
        onClose={() => setToRemove(null)}
        title="Remove this subscriber?"
      >
        <p className="font-sans text-14 text-ink-2">
          Remove {toRemove?.email} from your list? This can&apos;t be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setToRemove(null)}>
            Keep them
          </Button>
          <Button variant="danger" onClick={() => toRemove && confirmRemove(toRemove)}>
            Remove
          </Button>
        </div>
      </Dialog>

      {composing ? (
        <DropComposer
          activeCount={activeCount}
          contactAddress={contactAddress}
          dailyLimit={dailyLimit}
          remainingToday={remaining}
          onClose={() => setComposing(false)}
          onSent={(sent) => {
            setComposing(false);
            setRemaining((current) => Math.max(0, current - sent));
            showToast("success", `Sent to ${sent} subscribers.`);
          }}
          showToast={showToast}
        />
      ) : null}

      {toast ? (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <Toast tone={toast.tone}>{toast.message}</Toast>
        </div>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  primary
}: {
  label: string;
  value: string;
  sub: string;
  primary?: boolean;
}) {
  return (
    <div
      className={
        primary
          ? "rounded-md border border-verdigris bg-verdigris-3 p-4"
          : "rounded-md border border-line bg-surface p-4"
      }
    >
      <div className="font-sans text-12 uppercase tracking-[0.06em] text-ink-3">
        {label}
      </div>
      <div className="mt-1 font-mono text-22 font-bold tabular-nums text-ink">
        {value}
      </div>
      <div className="mt-1 font-sans text-12 text-ink-3">{sub}</div>
    </div>
  );
}

function DropComposer({
  activeCount,
  contactAddress,
  dailyLimit,
  remainingToday,
  onClose,
  onSent,
  showToast
}: {
  activeCount: number;
  contactAddress: string | null;
  dailyLimit: number;
  remainingToday: number;
  onClose: () => void;
  onSent: (sent: number) => void;
  showToast: (tone: "success" | "danger", message: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  const missingAddress = !contactAddress;
  const overDailyLimit = activeCount > remainingToday;
  const canSend =
    activeCount > 0 &&
    !missingAddress &&
    !overDailyLimit &&
    !isPending &&
    subject.trim() !== "" &&
    body.trim() !== "";

  function send() {
    startTransition(async () => {
      const res = await sendDrop({ subject, body });
      if (res.ok) {
        onSent(res.sent);
      } else {
        showToast(
          "danger",
          res.error ??
            Object.values(res.fieldErrors ?? {})[0] ??
            "We couldn't send that drop."
        );
      }
    });
  }

  return (
    <Dialog open onClose={onClose} title="Send a drop">
      {missingAddress ? (
        <div className="rounded-md border border-line bg-paper-2 p-4">
          <p className="font-sans text-14 text-ink-2">
            Add your mailing address in Settings before sending drops.
          </p>
          <Button className="mt-3" asChild variant="secondary">
            <Link href="/dashboard/settings">Go to settings</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="font-sans text-12 uppercase tracking-[0.06em] text-ink-3">
              Subject
            </span>
            <Input
              className="mt-1"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={150}
              placeholder="Saturday bake list is up"
            />
          </label>
          <label className="block">
            <span className="font-sans text-12 uppercase tracking-[0.06em] text-ink-3">
              Message
            </span>
            <Textarea
              className="mt-1 min-h-32"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              placeholder="Tell your subscribers what's fresh."
            />
          </label>
          <p className="font-sans text-12 text-ink-3">
            We&apos;ll send one email per active subscriber. Daily limit:{" "}
            <span className="font-mono tabular-nums">{dailyLimit}</span>. Every email
            includes a one-click unsubscribe link.
          </p>
          {overDailyLimit ? (
            <p className="rounded-md border border-line bg-paper-2 p-3 font-sans text-13 text-ink-2">
              Today&apos;s limit has{" "}
              <span className="font-mono tabular-nums">{remainingToday}</span> emails
              left, and your active list has{" "}
              <span className="font-mono tabular-nums">{activeCount}</span>.
            </p>
          ) : null}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!canSend} onClick={send}>
          Send to <span className="font-mono tabular-nums">{activeCount}</span>
        </Button>
      </div>
    </Dialog>
  );
}
