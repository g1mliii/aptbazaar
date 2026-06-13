import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type SheetProps = HTMLAttributes<HTMLDivElement>;

export function Sheet({ className, ...props }: SheetProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface p-4 shadow-lg sm:p-6",
        className
      )}
      {...props}
    />
  );
}
