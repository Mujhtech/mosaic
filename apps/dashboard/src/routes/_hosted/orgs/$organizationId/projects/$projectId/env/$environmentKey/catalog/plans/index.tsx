import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { PlansPage } from "@/features/catalog/components/plans-page"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/plans/",
)({
  component: CatalogPlansRoute,
  pendingComponent: RoutePendingState,
})

function CatalogPlansRoute() {
  const { organizationId, projectId } = Route.useParams()

  return <PlansPage organizationId={organizationId} projectId={projectId} />
}
