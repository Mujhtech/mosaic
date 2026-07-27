import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ApplicationsPage } from "@/features/projects/components/applications-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/apps",
)({
  component: ProjectAppsRoute,
  pendingComponent: RoutePendingState,
})

function ProjectAppsRoute() {
  const { organizationId, projectId } = Route.useParams()

  return <ApplicationsPage organizationId={organizationId} projectId={projectId} />
}
