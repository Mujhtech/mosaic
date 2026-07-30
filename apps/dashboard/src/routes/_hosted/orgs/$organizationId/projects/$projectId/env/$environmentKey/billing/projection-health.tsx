import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ProjectionHealthPage } from "@/features/billing-projection/components/projection-health-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/projection-health",
)({
  component: ProjectionHealthRoute,
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
