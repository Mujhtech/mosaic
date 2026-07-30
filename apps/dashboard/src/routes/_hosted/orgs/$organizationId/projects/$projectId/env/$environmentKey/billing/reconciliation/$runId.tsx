import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ReconciliationRunDetailPage } from "@/features/billing-operations/components/reconciliation-run-detail-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/reconciliation/$runId",
)({
  component: BillingReconciliationRunRoute,
  pendingComponent: RoutePendingState,
})

function BillingReconciliationRunRoute() {
  const { organizationId, projectId, runId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return (
    <ReconciliationRunDetailPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      runId={runId}
    />
  )
}
