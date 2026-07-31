import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { CustomerDetailPage } from "@/features/billing-customers/components/customer-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/customers/$customerId",
)({
  component: CustomerDetailRoute,
  pendingComponent: RoutePendingState,
})

function CustomerDetailRoute() {
  const { customerId, environmentId, organizationId, projectId } = Route.useParams()
  return (
    <CustomerDetailPage
      customerId={customerId}
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
