import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ProjectOverviewPage } from "@/features/projects/components/project-overview-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/",
)({
  component: ProjectRoute,
  head: () => routeHead({ title: "Project overview" }),
  pendingComponent: RoutePendingState,
})

function ProjectRoute() {
  const { organizationId, projectId } = Route.useParams()

  return <ProjectOverviewPage organizationId={organizationId} projectId={projectId} />
}
