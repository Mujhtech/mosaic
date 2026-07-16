import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ErrorStateProps {
  className?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  title?: string
}

export function ErrorState({
  className,
  description = "The requested view could not be loaded. Please try again.",
  onRetry,
  retryLabel = "Try again",
  title = "Something went wrong",
}: ErrorStateProps) {
  return (
    <section
      className={cn(
        "border-destructive/20 bg-destructive/5 flex min-h-48 flex-col items-start justify-center rounded-xl border p-6",
        className,
      )}
      role="alert"
    >
      <p className="text-foreground text-base font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 max-w-prose text-sm leading-6">{description}</p>
      {onRetry ? (
        <Button className="mt-5" onClick={onRetry} type="button" variant="outline">
          {retryLabel}
        </Button>
      ) : null}
    </section>
  )
}
