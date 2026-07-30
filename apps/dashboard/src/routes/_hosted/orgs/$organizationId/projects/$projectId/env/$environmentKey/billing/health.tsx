import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { BillingHealthPage } from "@/features/billing-operations/components/billing-health-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/health",
)({
  component: BillingHealthRoute,
  pendingComponent: RoutePendingState,
})

function BillingHealthRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return (
    <BillingHealthPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
