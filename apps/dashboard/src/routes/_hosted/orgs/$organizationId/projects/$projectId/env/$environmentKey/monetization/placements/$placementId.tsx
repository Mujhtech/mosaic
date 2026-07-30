import { createFileRoute } from "@tanstack/react-router"

import { PlacementDecisionPage } from "@/features/placement-decisions/components/placement-decision-page"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/placements/$placementId",
)({ component: PlacementDecisionRoute })

function PlacementDecisionRoute() {
  const params = Route.useParams()
  return <PlacementDecisionPage {...params} />
}
