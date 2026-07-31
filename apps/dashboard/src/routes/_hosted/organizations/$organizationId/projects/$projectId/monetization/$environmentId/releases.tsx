import { createFileRoute } from "@tanstack/react-router"

import { ReleaseHistoryPage } from "@/features/releases/components/release-history-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/releases",
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  return (
    <ReleaseHistoryPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
