import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { SubscriptionDetailPage } from "@/features/billing-customers/components/subscription-detail-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"
import { routeHead } from "@/lib/routing/route-head"

interface SubscriptionSearch {
  cursor?: string
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/subscriptions/$instanceId",
)({
  component: SubscriptionDetailRoute,
  head: () => routeHead({ title: "Subscription" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): SubscriptionSearch => ({
    cursor:
      typeof search.cursor === "string" && search.cursor.length > 0 && search.cursor.length <= 512
        ? search.cursor
        : undefined,
  }),
})

function SubscriptionDetailRoute() {
  const { instanceId, organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  const { cursor } = Route.useSearch()
  const navigate = Route.useNavigate()
  if (!environmentId) return fallback

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
