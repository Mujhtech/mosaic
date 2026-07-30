import { createFileRoute } from "@tanstack/react-router"

import { PlacementDecisionPage } from "@/features/placement-decisions/components/placement-decision-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/placements/$placementId",
)({
  component: PlacementDecisionRoute,
  head: () => routeHead({ title: "Placement" }),
})

function PlacementDecisionRoute() {
  const params = Route.useParams()
  return <PlacementDecisionPage {...params} />
}
