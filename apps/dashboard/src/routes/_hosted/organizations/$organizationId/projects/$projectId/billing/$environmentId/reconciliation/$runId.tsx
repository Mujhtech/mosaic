import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ReconciliationRunDetailPage } from "@/features/billing-operations/components/reconciliation-run-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/reconciliation/$runId",
)({
  component: BillingReconciliationRunRoute,
  pendingComponent: RoutePendingState,
})

function BillingReconciliationRunRoute() {
  const { environmentId, organizationId, projectId, runId } = Route.useParams()
  return (
    <ReconciliationRunDetailPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      runId={runId}
    />
  )
}
