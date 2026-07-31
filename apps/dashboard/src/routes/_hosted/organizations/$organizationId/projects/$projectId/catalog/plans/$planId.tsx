import { createFileRoute } from "@tanstack/react-router"

import { PlanDetailPage } from "@/features/catalog/components/plan-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/plans/$planId",
)({
  component: CatalogPlanRoute,
})

function CatalogPlanRoute() {
  const { organizationId, planId, projectId } = Route.useParams()

  return <PlanDetailPage organizationId={organizationId} planId={planId} projectId={projectId} />
}
