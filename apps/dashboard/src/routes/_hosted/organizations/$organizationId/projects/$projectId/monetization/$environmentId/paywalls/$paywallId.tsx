import { createFileRoute } from "@tanstack/react-router"

import { PaywallDetailPage } from "@/features/paywalls/components/paywall-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/paywalls/$paywallId",
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { environmentId, organizationId, paywallId, projectId } = Route.useParams()
  return (
    <PaywallDetailPage
      environmentId={environmentId}
      organizationId={organizationId}
      paywallId={paywallId}
      projectId={projectId}
    />
  )
}
