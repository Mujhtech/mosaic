import { cn } from "@/lib/utils"

interface LoadingStateProps {
  className?: string
  description?: string
  title?: string
}

export function LoadingState({ className, description, title = "Loading" }: LoadingStateProps) {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className={cn(
        "border-border/70 bg-card/75 flex min-h-36 items-center justify-center gap-3 rounded-xl border p-6 text-left shadow-xs",
        className,
      )}
      role="status"
    >
      <span
        aria-hidden="true"
        className="border-muted-foreground/25 border-t-primary size-4 animate-spin rounded-full border-2 motion-reduce:animate-none"
      />
      <span>
        <span className="text-foreground block text-sm font-medium">{title}</span>
        {description ? (
          <span className="text-muted-foreground mt-0.5 block text-sm">{description}</span>
        ) : null}
      </span>
    </section>
  )
}
