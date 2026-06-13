import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

type ReceiptLine = {
  label: string;
  value: string;
};

type ReceiptProps = HTMLAttributes<HTMLDivElement> & {
  lines: ReceiptLine[];
  meta?: string;
  number?: string;
  title: string;
  total: string;
};

export function Receipt({
  className,
  lines,
  meta,
  number,
  title,
  total,
  ...props
}: ReceiptProps) {
  return (
    <div
      className={cn(
        "w-full rounded-md border border-line bg-surface p-5 font-mono text-13 text-ink shadow-stamp tabular-nums",
        className
      )}
      {...props}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-dashed border-line pb-3">
        <span className="font-sans text-14 font-bold uppercase">{title}</span>
        {number ? <span className="text-ink-3">{number}</span> : null}
      </div>
      <div className="space-y-1">
        {lines.map((line) => (
          <div className="flex justify-between gap-4" key={line.label}>
            <span>{line.label}</span>
            <span>{line.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between gap-4 border-t border-dashed border-line pt-3 text-15 font-bold">
        <span>TOTAL</span>
        <span>{total}</span>
      </div>
      {meta ? (
        <div className="mt-4 font-sans text-12 uppercase tracking-[0.04em] text-ink-3">
          {meta}
        </div>
      ) : null}
    </div>
  );
}
