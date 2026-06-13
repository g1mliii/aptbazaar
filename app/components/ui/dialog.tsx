"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

import { Button } from "./button";

type DialogProps = {
  children: ReactNode;
  className?: string;
  onClose?: () => void;
  open: boolean;
  title: string;
};

export function Dialog({
  children,
  className,
  onClose,
  open,
  title
}: DialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4">
      <section
        aria-label={title}
        aria-modal="true"
        className={cn(
          "w-full max-w-lg overscroll-contain rounded-lg border border-line bg-surface p-6 shadow-lg",
          className
        )}
        role="dialog"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="ab-h2">{title}</h2>
          {onClose ? (
            <Button aria-label="Close" onClick={onClose} size="sm" variant="ghost">
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {children}
      </section>
    </div>
  );
}
