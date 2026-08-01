import type { ReactNode } from "react";

import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { ApiError } from "@/lib/api/errors";

interface Props {
  children: ReactNode;
  error: Error | null;
  isPending: boolean;
  onRetry: () => void;
}

export function AnalyticsQueryResult({
  children,
  error,
  isPending,
  onRetry,
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
    return (
      <ErrorState
        description={error.message}
        onRetry={onRetry}
        title="Analytics could not be loaded"
      />
    );
  }
  return children;
}
