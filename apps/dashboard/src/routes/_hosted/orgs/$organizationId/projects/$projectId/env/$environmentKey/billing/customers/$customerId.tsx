import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { CustomerDetailPage } from "@/features/billing-customers/components/customer-detail-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/customers/$customerId",
)({
  component: CustomerDetailRoute,
  pendingComponent: RoutePendingState,
})

function CustomerDetailRoute() {
  const { customerId, organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return (
    <CustomerDetailPage
      customerId={customerId}
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
