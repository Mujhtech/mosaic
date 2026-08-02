import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  action?: ReactNode;
  className?: string;
  description: string;
  title: string;
}

export function EmptyState({
  action,
  className,
  description,
  title,
}: EmptyStateProps) {
  return (
    <section
      aria-live="polite"
      className={cn(
        "flex min-h-52 flex-col items-center justify-center rounded border border-border border-dashed bg-muted/25 px-6 py-10 text-center",
        className
      )}
      role="status"
    >
      <span
        aria-hidden="true"
        className="mb-5 grid size-10 place-items-center rounded border border-border bg-background shadow-xs"
      >
        <span className="size-2 rounded-full bg-primary" />
      </span>
      <p className="font-semibold text-foreground text-sm">{title}</p>
      <p className="mt-1 max-w-sm text-muted-foreground text-sm leading-6">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}
