import { createFileRoute } from "@tanstack/react-router"

import { PlanDetailPage } from "@/features/catalog/components/plan-detail-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/plans/$planId",
)({
  component: CatalogPlanRoute,
  head: () => routeHead({ title: "Plan" }),
})

function CatalogPlanRoute() {
  const { organizationId, planId, projectId } = Route.useParams()

  return <PlanDetailPage organizationId={organizationId} planId={planId} projectId={projectId} />
}
