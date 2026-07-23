import { createFileRoute } from "@tanstack/react-router"

import { ProjectOverviewPage } from "@/features/projects/components/project-overview-page"

export const Route = createFileRoute("/_hosted/organizations/$organizationId/projects/$projectId/")(
  {
    component: ProjectRoute,
  },
)

function ProjectRoute() {
  const { organizationId, projectId } = Route.useParams()

  return <ProjectOverviewPage organizationId={organizationId} projectId={projectId} />
}
