import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type StampStatus =
  | "new"
  | "accepted"
  | "preparing"
  | "ready"
  | "complete"
  | "cancelled"
  | "paid"
  | "refunded"
  | "refund_pending"
  | "refund_failed";

const statusColors: Record<StampStatus, string> = {
  new: "var(--ab-status-new-fg)",
  accepted: "var(--ab-status-accepted-fg)",
  preparing: "var(--ab-status-preparing-fg)",
  ready: "var(--ab-status-ready-fg)",
  complete: "var(--ab-status-complete-fg)",
  cancelled: "var(--ab-status-cancel-fg)",
  paid: "var(--ab-success)",
  refunded: "var(--ab-danger)",
  refund_pending: "var(--ab-ink-2)",
  refund_failed: "var(--ab-danger)"
};

type StampProps = HTMLAttributes<HTMLSpanElement> & {
  status?: StampStatus;
};

export function Stamp({
  children,
  className,
  status = "new",
  style,
  ...props
}: StampProps) {
  return (
    <span
      className={cn(
        "inline-flex rotate-[-3deg] items-center justify-center rounded-xs border-2 border-current bg-transparent px-3 py-1 font-sans text-12 font-extrabold uppercase tracking-[0.12em]",
        status === "ready" && "rotate-[-2deg]",
        (status === "cancelled" || status === "refunded") && "line-through",
        className
      )}
      style={{ color: statusColors[status], ...style }}
      {...props}
    >
      {children}
    </span>
  );
}
