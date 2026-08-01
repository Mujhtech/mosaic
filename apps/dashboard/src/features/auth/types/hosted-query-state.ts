import type { ReactNode } from "react";

import type { HostedResourceState } from "@/features/auth/components/hosted-resource-boundary";
import { ApiError, describeApiError } from "@/lib/api/errors";
import type { WorkspaceScope } from "@/lib/routing/workspace-hrefs";

interface HostedQueryStateBaseOptions {
  error: unknown;
  isPending: boolean;
  loadingDescription: string;
  onRetry?: () => void;
  permissionAction?: ReactNode;
  permissionDescription: string;
  /**
   * Identifiers a coded error's recovery link needs. Omitting it keeps the
   * specific explanation and drops only the link.
   */
  scope?: WorkspaceScope;
}

/**
 * Empty copy is required exactly when the caller can report an empty result.
 * A view that never renders the empty state, because emptiness is handled
 * inside its own body, must not be forced to pass placeholder strings.
 */
type HostedQueryEmptyOptions =
  | {
      emptyAction?: ReactNode;
      emptyDescription: string;
      emptyTitle: string;
      isEmpty: boolean;
    }
  | {
      emptyAction?: never;
      emptyDescription?: never;
      emptyTitle?: never;
      isEmpty: false;
    };

type ResolveHostedQueryStateOptions = HostedQueryStateBaseOptions &
  HostedQueryEmptyOptions;

export function resolveHostedQueryState(
  options: ResolveHostedQueryStateOptions
): HostedResourceState {
  const {
    error,
    isEmpty,
    isPending,
    loadingDescription,
    onRetry,
    permissionAction,
    permissionDescription,
    scope,
  } = options;

  if (isPending) {
    return { description: loadingDescription, kind: "loading" };
  }

  if (error instanceof ApiError && error.status === 401) {
    return { kind: "decision_required" };
  }

  if (error instanceof ApiError && error.status === 403) {
    return {
      ...(permissionAction === undefined ? {} : { action: permissionAction }),
      description: permissionDescription,
      kind: "permission",
    };
  }

  if (error) {
    const described = describeApiError(error, scope);
    const specifics = {
      ...(described.details ? { details: described.details } : {}),
      ...(described.recovery ? { recovery: described.recovery } : {}),
    };

    // A transport failure (offline, DNS, CORS, API down) is operationally
    // different from a server-reported error: Mosaic stays usable locally and
    // the request is worth retrying, so it renders as a degraded state.
    if (described.kind === "network") {
      return {
        description: described.description,
        kind: "degraded",
        onRetry,
        requestId: described.correlationId,
        ...specifics,
      };
    }

    return {
      description: described.description,
      kind: "error",
      onRetry,
      requestId: described.correlationId,
      ...specifics,
    };
  }

  if (isEmpty) {
    return {
      action: options.emptyAction,
      description: options.emptyDescription,
      kind: "empty",
      title: options.emptyTitle,
    };
  }

  return { kind: "ready" };
}
