import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { SubscriptionDetailPage } from "@/features/billing-customers/components/subscription-detail-page"

interface SubscriptionSearch {
  cursor?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/subscriptions/$instanceId",
)({
  component: SubscriptionDetailRoute,
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): SubscriptionSearch => ({
    cursor:
      typeof search.cursor === "string" && search.cursor.length > 0 && search.cursor.length <= 512
        ? search.cursor
        : undefined,
  }),
})

function SubscriptionDetailRoute() {
  const { environmentId, instanceId, organizationId, projectId } = Route.useParams()
  const { cursor } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <SubscriptionDetailPage
      {...(cursor ? { cursor } : {})}
      environmentId={environmentId}
      instanceId={instanceId}
      onCursorChange={(next) => {
        void navigate({ replace: true, search: next ? { cursor: next } : {} })
      }}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
