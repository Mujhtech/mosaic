import type { ErrorComponentProps } from "@tanstack/react-router"

import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorState } from "@/components/feedback/error-state"

export function RouteErrorState({ reset }: ErrorComponentProps) {
  return (
    <ErrorState
      className="mx-auto my-10 max-w-3xl"
      description="This route failed safely. Retry the request, or return to it after the service recovers."
      onRetry={reset}
    />
  )
}

export function RouteNotFoundState() {
  return (
    <EmptyState
      className="mx-auto my-10 max-w-3xl"
      description="The page may have moved, or the address may be incomplete."
      title="Page not found"
    />
  )
}
