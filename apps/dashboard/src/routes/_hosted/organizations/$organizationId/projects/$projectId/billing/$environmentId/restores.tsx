import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { RestoreJobsPage } from "@/features/billing-customers/components/restore-jobs-page"

interface RestoresSearch {
  cursor?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/restores",
)({
  component: RestoreJobsRoute,
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): RestoresSearch => ({
    cursor:
      typeof search.cursor === "string" && search.cursor.length > 0 && search.cursor.length <= 512
        ? search.cursor
        : undefined,
  }),
})

function RestoreJobsRoute() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  const { cursor } = Route.useSearch()
  const navigate = Route.useNavigate()

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
