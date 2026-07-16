import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

interface EmptyStateProps {
  action?: ReactNode
  className?: string
  description: string
  title: string
}

export function EmptyState({ action, className, description, title }: EmptyStateProps) {
  return (
    <section
      aria-live="polite"
      className={cn(
        "border-border bg-muted/25 flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center",
        className,
      )}
      role="status"
    >
      <span
        aria-hidden="true"
        className="border-border bg-background mb-5 grid size-10 place-items-center rounded-xl border shadow-xs"
      >
        <span className="bg-primary size-2 rounded-full" />
      </span>
      <p className="text-foreground text-sm font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm leading-6">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  )
}
