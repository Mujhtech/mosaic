import { type ErrorComponentProps, Link } from "@tanstack/react-router";
import { useCallback } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { describeApiError } from "@/lib/api/errors";

function RouteRecoveryActions() {
  const handleClick = useCallback(() => {
    if (typeof window !== "undefined") {
      window.history.back();
    }
  }, []);
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Link className={buttonVariants({ variant: "outline" })} to="/workspace">
        Go to workspace
      </Link>
      <Button onClick={handleClick} type="button" variant="ghost">
        Go back
      </Button>
    </div>
  );
}

export function RouteErrorState({ error, reset }: ErrorComponentProps) {
  // Stack traces and raw server messages are never rendered; operators get the
  // correlation ID instead (client error reporting is off by design).
  const described = describeApiError(error);

  return (
    <div className="mx-auto my-10 max-w-3xl">
      <ErrorState
        description={
          described.kind === "unknown"
            ? "This route failed safely. Retry the request, or return to it after the service recovers."
            : described.description
        }
        onRetry={reset}
      />
      {described.correlationId ? (
        <p className="mt-3 text-muted-foreground text-xs">
          Request ID:{" "}
          <code className="select-all rounded bg-muted px-1 py-0.5 font-mono">
            {described.correlationId}
          </code>
        </p>
      ) : null}
      <RouteRecoveryActions />
    </div>
  );
}

export function RouteNotFoundState() {
  return (
    <div className="mx-auto my-10 max-w-3xl">
      <EmptyState
        description="The page may have moved, or the address may be incomplete."
        title="Page not found"
      />
      <RouteRecoveryActions />
    </div>
  );
}

export function RoutePendingState() {
  return (
    <LoadingState
      className="mx-auto my-10 max-w-3xl"
      description="Preparing your Mosaic workspace."
    />
  );
}
