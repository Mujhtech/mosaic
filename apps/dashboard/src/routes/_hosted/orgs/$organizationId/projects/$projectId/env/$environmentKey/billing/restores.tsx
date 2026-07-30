import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { RestoreJobsPage } from "@/features/billing-customers/components/restore-jobs-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"
import { routeHead } from "@/lib/routing/route-head"

interface RestoresSearch {
  cursor?: string
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/restores",
)({
  component: RestoreJobsRoute,
  head: () => routeHead({ title: "Restore jobs" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): RestoresSearch => ({
    cursor:
      typeof search.cursor === "string" && search.cursor.length > 0 && search.cursor.length <= 512
        ? search.cursor
        : undefined,
  }),
})

function RestoreJobsRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  const { cursor } = Route.useSearch()
  const navigate = Route.useNavigate()
  if (!environmentId) return fallback

  return (
    <RestoreJobsPage
      {...(cursor ? { cursor } : {})}
      environmentId={environmentId}
      onCursorChange={(next) => {
        void navigate({ replace: true, search: next ? { cursor: next } : {} })
      }}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
