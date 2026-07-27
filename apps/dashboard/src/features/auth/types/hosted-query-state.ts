import type { ReactNode } from "react"

import type { HostedResourceState } from "@/features/auth/components/hosted-resource-boundary"
import { ApiError, describeApiError } from "@/lib/api/errors"

interface ResolveHostedQueryStateOptions {
  emptyAction?: ReactNode
  emptyDescription: string
  emptyTitle: string
  error: unknown
  isEmpty: boolean
  isPending: boolean
  loadingDescription: string
  onRetry?: () => void
  permissionAction?: ReactNode
  permissionDescription: string
}

export function resolveHostedQueryState({
  emptyAction,
  emptyDescription,
  emptyTitle,
  error,
  isEmpty,
  isPending,
  loadingDescription,
  onRetry,
  permissionAction,
  permissionDescription,
}: ResolveHostedQueryStateOptions): HostedResourceState {
  if (isPending) {
    return { description: loadingDescription, kind: "loading" }
  }

  if (error instanceof ApiError && error.status === 401) {
    return { kind: "decision_required" }
  }

  if (error instanceof ApiError && error.status === 403) {
    return {
      ...(permissionAction !== undefined ? { action: permissionAction } : {}),
      description: permissionDescription,
      kind: "permission",
    }
  }

  if (error) {
    const described = describeApiError(error)

    // A transport failure (offline, DNS, CORS, API down) is operationally
    // different from a server-reported error: Mosaic stays usable locally and
    // the request is worth retrying, so it renders as a degraded state.
    if (described.kind === "network") {
      return {
        description: described.description,
        kind: "degraded",
        onRetry,
        requestId: described.correlationId,
      }
    }

    return {
      description: described.description,
      kind: "error",
      onRetry,
      requestId: described.correlationId,
    }
  }

  if (isEmpty) {
    return {
      action: emptyAction,
      description: emptyDescription,
      kind: "empty",
      title: emptyTitle,
    }
  }

  return { kind: "ready" }
}
