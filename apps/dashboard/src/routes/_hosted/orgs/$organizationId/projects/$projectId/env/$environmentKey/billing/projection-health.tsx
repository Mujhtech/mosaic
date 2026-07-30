import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ProjectionHealthPage } from "@/features/billing-projection/components/projection-health-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/projection-health",
)({
  component: ProjectionHealthRoute,
  head: () => routeHead({ title: "Projection health" }),
  pendingComponent: RoutePendingState,
})

function ProjectionHealthRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return (
    <ProjectionHealthPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
