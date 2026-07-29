import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { SubscriptionDetailPage } from "@/features/billing-customers/components/subscription-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/subscriptions/$instanceId",
)({
  component: SubscriptionDetailRoute,
  pendingComponent: RoutePendingState,
})

function SubscriptionDetailRoute() {
  const { environmentId, instanceId, organizationId, projectId } = Route.useParams()
  return (
    <SubscriptionDetailPage
      environmentId={environmentId}
      instanceId={instanceId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
