import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { QuarantineDetailPage } from "@/features/billing-operations/components/quarantine-detail-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/quarantine/$recordId",
)({
  component: BillingQuarantineDetailRoute,
  pendingComponent: RoutePendingState,
})

function BillingQuarantineDetailRoute() {
  const { organizationId, projectId, recordId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return (
    <QuarantineDetailPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      recordId={recordId}
    />
  )
}
