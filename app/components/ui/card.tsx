import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-line bg-surface p-4 text-ink shadow-sm sm:p-6",
        className
      )}
      {...props}
    />
  );
}
