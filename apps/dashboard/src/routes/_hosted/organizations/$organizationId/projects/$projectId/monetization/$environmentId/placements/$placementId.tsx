import { createFileRoute } from "@tanstack/react-router"

import { PlacementDecisionPage } from "@/features/placement-decisions/components/placement-decision-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/placements/$placementId",
)({ component: PlacementDecisionRoute })

function PlacementDecisionRoute() {
  const params = Route.useParams()
  return <PlacementDecisionPage {...params} />
}
