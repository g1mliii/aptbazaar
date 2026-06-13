import type { LucideIcon } from "lucide-react";
import { PackageOpen } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type EmptyStateProps = {
  action?: ReactNode;
  body: string;
  className?: string;
  icon?: LucideIcon;
  title: string;
};

export function EmptyState({
  action,
  body,
  className,
  icon: Icon = PackageOpen,
  title
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-line bg-surface px-6 py-8 text-center",
        className
      )}
    >
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-sm border border-line bg-paper-2 text-ink-3">
        <Icon aria-hidden="true" className="h-5 w-5 stroke-[1.5]" />
      </div>
      <h3 className="ab-h3">{title}</h3>
      <p className="ab-body-sm mx-auto mt-1 max-w-sm">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
