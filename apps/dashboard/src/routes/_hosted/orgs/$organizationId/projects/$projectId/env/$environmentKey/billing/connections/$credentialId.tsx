import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { StoreConnectionDetailPage } from "@/features/store-connections/components/store-connection-detail-page"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/connections/$credentialId",
)({
  component: BillingConnectionDetailRoute,
  pendingComponent: RoutePendingState,
})

function BillingConnectionDetailRoute() {
  const { credentialId, organizationId, projectId } = Route.useParams()
  return (
    <StoreConnectionDetailPage
      credentialId={credentialId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
