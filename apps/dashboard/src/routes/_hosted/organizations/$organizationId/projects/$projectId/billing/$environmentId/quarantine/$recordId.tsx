import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { QuarantineDetailPage } from "@/features/billing-operations/components/quarantine-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/quarantine/$recordId",
)({
  component: BillingQuarantineDetailRoute,
  pendingComponent: RoutePendingState,
})

function BillingQuarantineDetailRoute() {
  const { environmentId, organizationId, projectId, recordId } = Route.useParams()
  return (
    <QuarantineDetailPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      recordId={recordId}
    />
  )
}
