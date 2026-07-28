import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { StoreConnectionsPage } from "@/features/store-connections/components/store-connections-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/connections/",
)({
  component: BillingConnectionsRoute,
  pendingComponent: RoutePendingState,
})

function BillingConnectionsRoute() {
  const { organizationId, projectId } = Route.useParams()
  return <StoreConnectionsPage organizationId={organizationId} projectId={projectId} />
}
