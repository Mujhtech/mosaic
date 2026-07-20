import { createFileRoute } from "@tanstack/react-router"

import { PlansPage } from "@/features/catalog/components/plans-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/plans",
)({
  component: CatalogPlansRoute,
})

function CatalogPlansRoute() {
  const { organizationId, projectId } = Route.useParams()

  return <PlansPage organizationId={organizationId} projectId={projectId} />
}
