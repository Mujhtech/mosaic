import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { StoreConnectionsPage } from "@/features/store-connections/components/store-connections-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/connections/",
)({
  component: BillingConnectionsRoute,
  head: () => routeHead({ title: "Billing connections" }),
  pendingComponent: RoutePendingState,
})

function BillingConnectionsRoute() {
  const { organizationId, projectId } = Route.useParams()
  return <StoreConnectionsPage organizationId={organizationId} projectId={projectId} />
}
