import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

import type { StampStatus } from "./stamp";

const statusBackgrounds: Record<StampStatus, string> = {
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

type SealProps = HTMLAttributes<HTMLSpanElement> & {
  status?: StampStatus;
};

export function Seal({
  children,
  className,
  status = "new",
  style,
  ...props
}: SealProps) {
  return (
    <span
      className={cn(
        "relative inline-flex h-12 w-12 items-center justify-center rounded-pill p-2 text-center font-sans text-12 font-extrabold uppercase leading-none tracking-[0.04em] text-surface shadow-stamp",
        "before:absolute before:inset-1 before:rounded-pill before:border before:border-dashed before:border-surface/50 before:content-['']",
        className
      )}
      style={{ background: statusBackgrounds[status], ...style }}
      {...props}
    >
      <span className="relative">{children}</span>
    </span>
  );
}
