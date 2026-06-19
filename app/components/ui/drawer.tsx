"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type DrawerProps = {
  children: ReactNode;
  className?: string;
  open: boolean;
  side?: "right" | "bottom";
  title: string;
};

export function Drawer({
  children,
  className,
  open,
  side = "right",
  title
}: DrawerProps) {
  const titleId = useId();

  if (!open) {
    return null;
  }

  return (
    <aside
      aria-labelledby={titleId}
      aria-modal="true"
      className={cn(
        "fixed z-40 overflow-y-auto overscroll-contain border-line bg-surface p-6 shadow-lg",
        side === "right" && "inset-y-0 right-0 w-full max-w-md border-l rounded-l-lg",
        side === "bottom" && "inset-x-0 bottom-0 max-h-[80vh] rounded-t-lg border-t",
        className
      )}
      role="dialog"
    >
      <h2 className="ab-h2 mb-4" id={titleId}>
        {title}
      </h2>
      {children}
    </aside>
  );
}
