"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";

import { Button } from "@/app/components/ui/button";
import { Dialog } from "@/app/components/ui/dialog";
import { Drawer } from "@/app/components/ui/drawer";
import { Input, Textarea } from "@/app/components/ui/form";
import { Stamp } from "@/app/components/ui/stamp";
import { Toast } from "@/app/components/ui/toast";
import {
  cancelOrder,
  markPaid,
  updateOrderNotes,
  updateOrderStatus,
  type OrderActionResult
} from "@/lib/actions/orders";
import { createDashboardLoginLink } from "@/lib/actions/stripe-connect";
import { orderRefFrom } from "@/lib/orders/pickup";
import { computePlatformFee, formatBps, PLATFORM_FEE_BPS } from "@/lib/pricing/fee";
import { formatMoney } from "@/lib/pricing/currency";
import type { OrderStatus, PaymentMode, PaymentStatus } from "@/lib/schemas/order";
import { TRANSITIONS, willRefundOnCancel } from "@/lib/schemas/order";
import type { StampStatus } from "@/app/components/ui/stamp";
import { cn } from "@/lib/utils/cn";

export type BoardOrderItem = {
  name_at_purchase: string;
  quantity: number;
  price_cents_at_purchase: number;
};

export type BoardOrder = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone_e164: string | null;
  total_cents: number;
  order_status: OrderStatus;
  payment_status: PaymentStatus;
  payment_mode: PaymentMode;
  pickup_window: string | null;
  pickup_time: string | null;
  notes: string | null;
  notes_seller: string | null;
  notes_shared: string | null;
  created_at: string;
  order_items: BoardOrderItem[];
};

// Status → display label + stamp. The DB enum is canonical (ready/complete); the UI maps to the
// kit's "Ready"/"Picked up" labels. Same pattern as the tracking page's STAMP_LABEL.
const STATUS_VIEW: Record<OrderStatus, { label: string; stamp: StampStatus }> = {
  new: { label: "New", stamp: "new" },
  accepted: { label: "Accepted", stamp: "accepted" },
  preparing: { label: "Preparing", stamp: "preparing" },
  ready: { label: "Ready", stamp: "ready" },
  complete: { label: "Picked up", stamp: "complete" },
  cancelled: { label: "Cancelled", stamp: "cancelled" }
};

// The label for advancing out of each status. The target state itself is derived from TRANSITIONS
// (the one non-cancel next state), so the button can never offer a transition the DB would reject.
const ADVANCE_LABEL: Partial<Record<OrderStatus, string>> = {
  new: "Accept order",
  accepted: "Start preparing",
  preparing: "Mark ready for pickup",
  ready: "Mark picked up"
};

/** The forward action for a status, or null at a terminal state. */
function primaryAction(status: OrderStatus): { label: string; to: OrderStatus } | null {
  const to = TRANSITIONS[status].find((s) => s !== "cancelled");
  const label = ADVANCE_LABEL[status];
  return to && label ? { label, to } : null;
}

const ADVANCE_TOAST: Record<OrderStatus, string> = {
  new: "Updated.",
  accepted: "Order accepted.",
  preparing: "Now preparing.",
  ready: "Marked ready.",
  complete: "Marked picked up.",
  cancelled: "Order cancelled."
};

const REFUND_VIEW: Partial<
  Record<PaymentStatus, { label: string; stamp: StampStatus }>
> = {
  refund_pending: { label: "Refund pending", stamp: "refund_pending" },
  refunded: { label: "Refunded", stamp: "refunded" },
  refund_failed: { label: "Refund needs attention", stamp: "refund_failed" }
};

const FILTERS: { id: "all" | OrderStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "accepted", label: "Accepted" },
  { id: "preparing", label: "Preparing" },
  { id: "ready", label: "Ready" },
  { id: "complete", label: "Picked up" },
  { id: "cancelled", label: "Cancelled" }
];

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function itemsSummary(order: BoardOrder): string {
  return order.order_items
    .map((i) => `${i.quantity}× ${i.name_at_purchase}`)
    .join(", ");
}

type ToastState = { tone: "success" | "danger"; message: string } | null;

export function OrdersBoard({ orders }: { orders: BoardOrder[] }) {
  const [filter, setFilter] = useState<"all" | OrderStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(orders[0]?.id ?? null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [statusOverride, setStatusOverride] = useState<Map<string, OrderStatus>>(
    new Map()
  );
  const [paymentOverride, setPaymentOverride] = useState<Map<string, PaymentStatus>>(
    new Map()
  );
  const [toast, setToast] = useState<ToastState>(null);
  const [isPending, startTransition] = useTransition();
  const orderIds = useMemo(() => new Set(orders.map((o) => o.id)), [orders]);

  function liveOverrides<T>(prev: Map<string, T>): Map<string, T> {
    const next = new Map<string, T>();
    for (const [id, value] of prev) {
      if (orderIds.has(id)) next.set(id, value);
    }
    return next;
  }

  const statusOf = (o: BoardOrder): OrderStatus =>
    statusOverride.get(o.id) ?? o.order_status;
  const paymentOf = (o: BoardOrder): PaymentStatus =>
    paymentOverride.get(o.id) ?? o.payment_status;

  const showToast = (tone: "success" | "danger", message: string) =>
    setToast({ tone, message });

  // Clear a toast shortly after it shows.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    for (const o of orders) {
      const s = statusOf(o);
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, statusOverride]);

  const kpis = useMemo(() => {
    const today = orders.filter((o) => isToday(o.created_at));
    const counted = today.filter((o) => statusOf(o) !== "cancelled");
    const grossToday = counted.reduce((s, o) => s + o.total_cents, 0);
    const netToday = counted.reduce(
      (s, o) => s + (o.total_cents - computePlatformFee(o.total_cents)),
      0
    );
    const pending = today.filter((o) =>
      (["new", "accepted", "preparing", "ready"] as OrderStatus[]).includes(statusOf(o))
    ).length;
    return { ordersToday: today.length, grossToday, netToday, pending };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, statusOverride]);

  const filtered =
    filter === "all" ? orders : orders.filter((o) => statusOf(o) === filter);

  const selected = filtered.find((o) => o.id === selectedId) ?? filtered[0] ?? null;

  function select(id: string) {
    setSelectedId(id);
    setDrawerOpen(true);
  }

  function advance(order: BoardOrder, to: OrderStatus) {
    setStatusOverride((prev) => liveOverrides(prev).set(order.id, to));
    startTransition(async () => {
      const res = await updateOrderStatus({ orderId: order.id, to });
      if (!res.ok) {
        setStatusOverride((prev) => {
          const n = liveOverrides(prev);
          n.delete(order.id);
          return n;
        });
        showToast("danger", res.error);
      } else {
        showToast("success", ADVANCE_TOAST[to]);
      }
    });
  }

  function doMarkPaid(order: BoardOrder) {
    setPaymentOverride((prev) => liveOverrides(prev).set(order.id, "paid"));
    startTransition(async () => {
      const res = await markPaid(order.id);
      if (!res.ok) {
        setPaymentOverride((prev) => {
          const n = liveOverrides(prev);
          n.delete(order.id);
          return n;
        });
        showToast("danger", res.error);
      } else {
        showToast("success", "Marked paid.");
      }
    });
  }

  // After a confirmed cancel: optimistically reflect cancelled, and refund_pending only for an
  // order whose cancel just kicked off a refund (pay-at-pickup cancels start none).
  // revalidatePath reconciles once the server catches up.
  function applyCancelled(order: BoardOrder) {
    setStatusOverride((prev) => liveOverrides(prev).set(order.id, "cancelled"));
    if (willRefundOnCancel(order.payment_mode, paymentOf(order))) {
      setPaymentOverride((prev) => liveOverrides(prev).set(order.id, "refund_pending"));
    }
    showToast("success", "Order cancelled.");
  }

  async function openStripeDashboard() {
    const res = await createDashboardLoginLink();
    if (res.ok) {
      window.open(res.url, "_blank", "noopener,noreferrer");
    } else {
      showToast("danger", res.error);
    }
  }

  const detail = selected ? (
    <OrderDetail
      key={selected.id}
      isPending={isPending}
      onAdvance={advance}
      onCancelled={applyCancelled}
      onMarkPaid={doMarkPaid}
      onSaveNotes={updateOrderNotes}
      onStripeDashboard={openStripeDashboard}
      order={selected}
      showToast={showToast}
      status={statusOf(selected)}
      paymentStatus={paymentOf(selected)}
    />
  ) : null;

  return (
    <div>
      {/* KPIs */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi
          label="Orders today"
          value={String(kpis.ordersToday)}
          sub={`${kpis.pending} pending`}
        />
        <Kpi
          label="Revenue today"
          value={formatMoney(kpis.netToday)}
          sub={`net of ${formatBps(PLATFORM_FEE_BPS)} platform fee`}
          primary
        />
        <Kpi
          label="Gross today"
          value={formatMoney(kpis.grossToday)}
          sub="before fee"
        />
      </div>

      {/* Filter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 font-sans text-13 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris",
                active
                  ? "border-transparent bg-verdigris text-surface"
                  : "border-line bg-surface text-ink-2 hover:bg-paper-2"
              )}
            >
              {f.label}
              <span className="font-mono text-12 tabular-nums">
                {counts[f.id] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* List */}
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center font-sans text-14 text-ink-3">
              No orders in this status.
            </p>
          ) : (
            filtered.map((order) => {
              const view = STATUS_VIEW[statusOf(order)];
              return (
                <button
                  key={order.id}
                  type="button"
                  aria-pressed={order.id === selected?.id}
                  onClick={() => select(order.id)}
                  className={cn(
                    "grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-paper-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-verdigris",
                    order.id === selected?.id && "bg-paper-2"
                  )}
                >
                  <span className="font-mono text-12 tabular-nums text-ink-3">
                    {orderRefFrom(order.id)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-14 font-semibold text-ink">
                      {order.customer_name}
                    </span>
                    <span className="block truncate font-sans text-12 text-ink-3">
                      {itemsSummary(order)}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Stamp status={view.stamp}>{view.label}</Stamp>
                    <span className="text-right">
                      <span className="block font-mono text-14 font-medium tabular-nums text-ink">
                        {formatMoney(order.total_cents)}
                      </span>
                      <span
                        className="block font-sans text-12 text-ink-3"
                        suppressHydrationWarning
                      >
                        {timeAgo(order.created_at)}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Detail — desktop right column */}
        <div className="hidden lg:block">{detail}</div>
      </div>

      {/* Detail — mobile bottom drawer */}
      <div className="lg:hidden">
        {drawerOpen && selected ? (
          <>
            <div
              className="fixed inset-0 z-30 bg-ink/30"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <Drawer
              open
              side="bottom"
              title={`Order ${orderRefFrom(selected.id)}`}
              onBack={() => setDrawerOpen(false)}
              className="pb-0"
            >
              {detail}
            </Drawer>
          </>
        ) : null}
      </div>

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
      className={cn(
        "rounded-md border p-4",
        primary ? "border-verdigris bg-verdigris-3" : "border-line bg-surface"
      )}
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

type DetailProps = {
  order: BoardOrder;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  isPending: boolean;
  onAdvance: (order: BoardOrder, to: OrderStatus) => void;
  onMarkPaid: (order: BoardOrder) => void;
  onCancelled: (order: BoardOrder) => void;
  onSaveNotes: (input: {
    orderId: string;
    notesSeller?: string | null;
    notesShared?: string | null;
  }) => Promise<OrderActionResult>;
  onStripeDashboard: () => void;
  showToast: (tone: "success" | "danger", message: string) => void;
};

function OrderDetail({
  order,
  status,
  paymentStatus,
  isPending,
  onAdvance,
  onMarkPaid,
  onCancelled,
  onSaveNotes,
  onStripeDashboard,
  showToast
}: DetailProps) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelInput, setCancelInput] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, startCancel] = useTransition();

  const [notesSeller, setNotesSeller] = useState(order.notes_seller ?? "");
  const [notesShared, setNotesShared] = useState(order.notes_shared ?? "");
  const [, startNotes] = useTransition();

  const primary = primaryAction(status);
  const view = STATUS_VIEW[status];
  const refundView = REFUND_VIEW[paymentStatus];
  const willRefund = willRefundOnCancel(order.payment_mode, paymentStatus);
  const showMarkPaid =
    order.payment_mode === "pay_at_pickup" && paymentStatus === "pay_at_pickup";
  const terminal = status === "complete" || status === "cancelled";

  function saveNote(field: "seller" | "shared", value: string) {
    const original =
      field === "seller" ? (order.notes_seller ?? "") : (order.notes_shared ?? "");
    if (value === original) return;
    const patch =
      field === "seller"
        ? { orderId: order.id, notesSeller: value || null }
        : { orderId: order.id, notesShared: value || null };
    startNotes(async () => {
      const res = await onSaveNotes(patch);
      if (res.ok) {
        showToast("success", "Saved.");
      } else {
        showToast("danger", res.error);
      }
    });
  }

  function confirmCancel() {
    setCancelError(null);
    startCancel(async () => {
      const res = await cancelOrder(order.id);
      if (res.ok) {
        onCancelled(order);
        setCancelOpen(false);
        setCancelInput("");
      } else {
        setCancelError(res.error);
      }
    });
  }

  return (
    <div className="rounded-lg border border-line bg-surface shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-line p-5">
        <div className="min-w-0">
          <div className="font-mono text-12 uppercase tracking-[0.08em] text-ink-3">
            Order {orderRefFrom(order.id)}
          </div>
          <div className="mt-1 truncate text-18 font-semibold text-ink">
            {order.customer_name}
          </div>
          <div className="truncate font-sans text-13 text-ink-3">
            {order.customer_email}
          </div>
          {order.customer_phone_e164 ? (
            <div className="truncate font-mono text-13 tabular-nums text-ink-3">
              {order.customer_phone_e164}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Stamp status={view.stamp}>{view.label}</Stamp>
          {refundView ? (
            <Stamp status={refundView.stamp}>{refundView.label}</Stamp>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 p-5">
        {order.pickup_window ? <Row label="Pickup">{order.pickup_window}</Row> : null}

        <div>
          <div className="font-sans text-12 uppercase tracking-[0.06em] text-ink-3">
            Items
          </div>
          <div className="mt-2 space-y-1">
            {order.order_items.map((it, i) => (
              <div className="flex items-center justify-between gap-4" key={i}>
                <span className="font-sans text-14 text-ink">
                  {it.quantity}× {it.name_at_purchase}
                </span>
                <span className="font-mono text-14 tabular-nums text-ink">
                  {formatMoney(it.price_cents_at_purchase * it.quantity)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 border-t border-line pt-2">
              <span className="font-sans text-12 uppercase tracking-[0.06em] text-ink-3">
                Total
              </span>
              <span className="font-mono text-15 font-bold tabular-nums text-ink">
                {formatMoney(order.total_cents)}
              </span>
            </div>
          </div>
        </div>

        {order.notes ? (
          <Row label="Customer note">
            <span className="italic">“{order.notes}”</span>
          </Row>
        ) : null}

        {refundView?.stamp === "refund_failed" ? (
          <div className="rounded-md border border-danger bg-danger-3 p-3">
            <p className="font-sans text-13 text-danger">
              This refund didn&apos;t go through. Finish it in your Stripe dashboard.
            </p>
            <Button
              className="mt-2"
              size="sm"
              variant="secondary"
              onClick={onStripeDashboard}
            >
              Open Stripe dashboard
            </Button>
          </div>
        ) : null}

        {/* Notes editors */}
        <div className="space-y-3">
          <label className="block">
            <span className="font-sans text-12 uppercase tracking-[0.06em] text-ink-3">
              Private note
            </span>
            <Textarea
              className="mt-1"
              value={notesSeller}
              onChange={(e) => setNotesSeller(e.target.value)}
              onBlur={(e) => saveNote("seller", e.target.value)}
              placeholder="Only you see this."
              maxLength={2000}
            />
          </label>
          <label className="block">
            <span className="font-sans text-12 uppercase tracking-[0.06em] text-ink-3">
              Note for customer
            </span>
            <Textarea
              className="mt-1"
              value={notesShared}
              onChange={(e) => setNotesShared(e.target.value)}
              onBlur={(e) => saveNote("shared", e.target.value)}
              placeholder="Shows on their tracking page."
              maxLength={2000}
            />
          </label>
        </div>
      </div>

      {/* Sticky action bar (6.9): one-tap primary + cancel at the bottom of the panel/drawer. */}
      <div className="sticky bottom-0 space-y-2 border-t border-line bg-surface p-4">
        {primary ? (
          <Button
            className="w-full"
            disabled={isPending}
            onClick={() => onAdvance(order, primary.to)}
          >
            {primary.label}
          </Button>
        ) : null}
        {status === "complete" ? (
          <Button className="w-full" disabled variant="secondary">
            Completed
          </Button>
        ) : null}
        {showMarkPaid ? (
          <Button
            className="w-full"
            disabled={isPending}
            variant="secondary"
            onClick={() => onMarkPaid(order)}
          >
            Mark as paid
          </Button>
        ) : null}
        {!terminal ? (
          <Button
            className="w-full"
            variant="danger"
            onClick={() => setCancelOpen(true)}
          >
            {willRefund ? "Cancel & refund" : "Cancel order"}
          </Button>
        ) : null}
      </div>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={willRefund ? "Cancel & refund this order?" : "Cancel this order?"}
      >
        <p className="font-sans text-14 text-ink-2">
          {willRefund
            ? "This cancels the order and starts a full refund to the customer. The refund can take 5–10 business days to land in their bank."
            : "This cancels the order and lets the customer know. Anything reserved goes back to your stock."}
        </p>
        <p className="mt-3 font-sans text-13 text-ink-3">
          Type <span className="font-mono font-bold">CANCEL</span> to confirm.
        </p>
        <Input
          aria-label="Type CANCEL to confirm"
          className="mt-2"
          value={cancelInput}
          onChange={(e) => setCancelInput(e.target.value)}
          placeholder="CANCEL"
          autoComplete="off"
          name="cancel-confirmation"
          spellCheck={false}
        />
        {cancelError ? (
          <Toast className="mt-3 w-full justify-center" tone="danger">
            {cancelError}
          </Toast>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCancelOpen(false)}>
            Keep order
          </Button>
          <Button
            variant="danger"
            disabled={cancelInput !== "CANCEL" || cancelling}
            onClick={confirmCancel}
          >
            {willRefund ? "Cancel & refund" : "Cancel order"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="font-sans text-12 uppercase tracking-[0.06em] text-ink-3">
        {label}
      </div>
      <div className="mt-1 font-sans text-14 text-ink">{children}</div>
    </div>
  );
}
