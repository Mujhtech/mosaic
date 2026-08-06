import type { ReactNode } from "react";

import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Button } from "@/components/ui/button";
import {
  ApiErrorDetails,
  ApiErrorRecoveryAction,
  RequestIdCopy,
} from "@/features/auth/components/hosted-resource-boundary";
import { ApiError, describeApiError } from "@/lib/api/errors";
import type { WorkspaceScope } from "@/lib/routing/workspace-hrefs";

interface Props {
  children: ReactNode;
  error: Error | null;
  isPending: boolean;
  onRetry: () => void;
  /** Identifiers a recovery destination needs. Without them the link is omitted. */
  scope?: WorkspaceScope;
}

export function AnalyticsQueryResult({
  children,
  error,
  isPending,
  onRetry,
  scope,
}: Props) {
  if (isPending) {
    return (
      <LoadingState
        description="Loading accepted, deduplicated analytics."
        title="Loading analytics"
      />
    );
  }
  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <ErrorState
          description="Project membership with access to this Environment is required."
          onRetry={onRetry}
          title="Analytics permission required"
        />
      );
    }
    return <AnalyticsFailure error={error} onRetry={onRetry} scope={scope} />;
  }
  return children;
}

/**
 * A failed analytics read, in Mosaic's own words.
 *
 * The raw `error.message` is never printed: a server message can carry query
 * text, driver detail, or internal identifiers, and it is not copy Mosaic
 * controls. `describeApiError` supplies the explanation, the coded specifics,
 * and the correlation identifier that connects this screen to the server log —
 * the documented support path everywhere else in the dashboard.
 */
function AnalyticsFailure({
  error,
  onRetry,
  scope,
}: {
  error: Error;
  onRetry: () => void;
  scope?: WorkspaceScope;
}) {
  const failure = describeApiError(error, scope);

  return (
    <section
      className="flex min-h-48 flex-col items-start justify-center gap-3 rounded border border-destructive/20 bg-destructive/5 p-6"
      role="alert"
    >
      <div>
        <p className="font-semibold text-base text-foreground">
          Analytics could not be loaded
        </p>
        <p className="mt-1 max-w-prose text-muted-foreground text-sm leading-6">
          {failure.description}
        </p>
      </div>
      <ApiErrorDetails details={failure.details} />
      {failure.recovery ? (
        <ApiErrorRecoveryAction recovery={failure.recovery} />
      ) : null}
      {failure.retryable ? (
        <Button onClick={onRetry} type="button" variant="outline">
          Try again
        </Button>
      ) : null}
      {failure.correlationId ? (
        <RequestIdCopy requestId={failure.correlationId} />
      ) : null}
    </section>
  );
}
