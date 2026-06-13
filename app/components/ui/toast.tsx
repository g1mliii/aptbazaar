import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type ToastProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "default" | "success" | "danger";
};

const tones: Record<NonNullable<ToastProps["tone"]>, string> = {
  default: "border-line bg-surface text-ink",
  success: "border-success bg-success-3 text-success",
  danger: "border-danger bg-danger-3 text-danger"
};

export function Toast({
  "aria-live": ariaLive = "polite",
  children,
  className,
  role = "status",
  tone = "default",
  ...props
}: ToastProps) {
  return (
    <div
      aria-live={ariaLive}
      className={cn(
        "inline-flex rounded-pill border px-4 py-2 font-sans text-13 font-semibold shadow-sm",
        tones[tone],
        className
      )}
      role={role}
      {...props}
    >
      {children}
    </div>
  );
}
