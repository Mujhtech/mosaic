import { cn } from "@/lib/utils";

interface LoadingStateProps {
  className?: string;
  description?: string;
  title?: string;
}

export function LoadingState({
  className,
  description,
  title = "Loading",
}: LoadingStateProps) {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className={cn(
        "flex min-h-36 items-center justify-center gap-3 rounded border border-border/70 bg-card/75 p-6 text-left shadow-xs",
        className
      )}
      role="status"
    >
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-primary motion-reduce:animate-none"
      />
      <span>
        <span className="block font-medium text-foreground text-sm">
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 block text-muted-foreground text-sm">
            {description}
          </span>
        ) : null}
      </span>
    </section>
  );
}
