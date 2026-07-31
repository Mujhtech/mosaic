import type { ReactNode } from "react";
import { Component } from "react";

import { ErrorState } from "@/components/feedback/error-state";
import { describeApiError } from "@/lib/api/errors";

interface AppErrorBoundaryState {
  error: unknown;
}

/**
 * Last-resort boundary mounted above the application providers.
 *
 * A render failure inside a provider (query client, tooltip portal, theme)
 * escapes the router's route-level boundaries and would otherwise blank the
 * page. Mosaic ships no client error reporting by design, so nothing is sent
 * anywhere: the operator gets recovery actions and, when available, the
 * correlation identifier to quote to whoever runs the API.
 */
// biome-ignore lint/style/useReactFunctionComponents: React implements error boundaries only via componentDidCatch on a class
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    const described = describeApiError(this.state.error);

    return (
      <div className="mx-auto my-10 max-w-3xl px-4">
        <ErrorState
          description="Mosaic stopped rendering unexpectedly. Reload the page; unsaved local Studio work is kept in this browser."
          onRetry={() => {
            this.setState({ error: null });
          }}
          retryLabel="Try rendering again"
          title="The dashboard could not be displayed"
        />
        {described.correlationId ? (
          <p className="mt-3 text-muted-foreground text-xs">
            Request ID:{" "}
            <code className="select-all rounded bg-muted px-1 py-0.5 font-mono">
              {described.correlationId}
            </code>
          </p>
        ) : null}
      </div>
    );
  }
}
