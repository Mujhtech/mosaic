import { createFileRoute } from "@tanstack/react-router"

import { PlacementsPage } from "@/features/placements/components/placements-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/placements",
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  return (
    <PlacementsPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
