import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { BillingHealthPage } from "@/features/billing-operations/components/billing-health-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/health",
)({
  component: BillingHealthRoute,
  pendingComponent: RoutePendingState,
})

function BillingHealthRoute() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  return (
    <BillingHealthPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
