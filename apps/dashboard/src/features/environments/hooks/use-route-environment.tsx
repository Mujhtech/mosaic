import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { useActiveEnvironment } from "@/features/environments/hooks/use-active-environment"

/**
 * Turns the Environment alias in the address into the id a page needs.
 *
 * Routes carry `prod`, `staging`, or `dev`; the API takes ids. Resolving the two
 * requires the Project's Environment list, so it is asynchronous, and a route
 * cannot hand an id to its page until that read lands. This is the one place that
 * waits, so no page has to:
 *
 *   const { environmentId, fallback } = useRouteEnvironment()
 *   if (!environmentId) return fallback
 *
 * `fallback` reports loading, an unreachable API, and an alias the Project has no
 * Environment for, which is what a hand-edited or stale address looks like.
 */
export function useRouteEnvironment() {
  const { pathEnvironment, query } = useActiveEnvironment()

  if (pathEnvironment) return { environmentId: pathEnvironment.id, fallback: undefined }

  const state = resolveHostedQueryState({
    emptyDescription:
      "This address names an environment the project does not have. Choose one from the sidebar.",
    emptyTitle: "Environment not found",
    error: query.error,
    // Resolved against the address only. Standing in a remembered Environment here
    // would show one Environment while the address named another.
    isEmpty: query.isSuccess,
    isPending: query.isPending,
    loadingDescription: "Loading the project's environments.",
    onRetry: () => void query.refetch(),
    permissionDescription: "Project membership is required to read this environment.",
  })

  return {
    environmentId: undefined,
    fallback: <HostedResourceBoundary state={state}>{null}</HostedResourceBoundary>,
  }
}
