import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ReconciliationPage } from "@/features/billing-operations/components/reconciliation-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/reconciliation/",
)({
  component: BillingReconciliationRoute,
  pendingComponent: RoutePendingState,
})

function BillingReconciliationRoute() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  return (
    <ReconciliationPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
