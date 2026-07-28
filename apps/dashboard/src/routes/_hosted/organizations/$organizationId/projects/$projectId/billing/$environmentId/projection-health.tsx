import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ProjectionHealthPage } from "@/features/billing-projection/components/projection-health-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/projection-health",
)({
  component: ProjectionHealthRoute,
  pendingComponent: RoutePendingState,
})

function ProjectionHealthRoute() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  return (
    <ProjectionHealthPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
