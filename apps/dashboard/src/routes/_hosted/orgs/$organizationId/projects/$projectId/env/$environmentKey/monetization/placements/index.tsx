import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { PlacementsPage } from "@/features/placements/components/placements-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/placements/",
)({
  component: RouteComponent,
  pendingComponent: RoutePendingState,
})

function RouteComponent() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return (
    <PlacementsPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
