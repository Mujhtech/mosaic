import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  className?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  title?: string;
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
        "flex min-h-48 flex-col items-start justify-center rounded border border-destructive/20 bg-destructive/5 p-6",
        className
      )}
      role="alert"
    >
      <p className="font-semibold text-base text-foreground">{title}</p>
      <p className="mt-1 max-w-prose text-muted-foreground text-sm leading-6">
        {description}
      </p>
      {onRetry ? (
        <Button
          className="mt-5"
          onClick={onRetry}
          type="button"
          variant="outline"
        >
          {retryLabel}
        </Button>
      ) : null}
    </section>
  );
}
