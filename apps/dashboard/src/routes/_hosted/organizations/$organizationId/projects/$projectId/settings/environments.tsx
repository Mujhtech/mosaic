import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { EnvironmentsPage } from "@/features/environments/components/environments-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/settings/environments",
)({
  component: ProjectEnvironmentsRoute,
  pendingComponent: RoutePendingState,
})

function ProjectEnvironmentsRoute() {
  const { organizationId, projectId } = Route.useParams()

  return <EnvironmentsPage organizationId={organizationId} projectId={projectId} />
}
