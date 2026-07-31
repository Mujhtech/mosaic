import { createFileRoute } from "@tanstack/react-router"

import { PaywallsPage } from "@/features/paywalls/components/paywalls-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/paywalls",
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  return (
    <PaywallsPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
