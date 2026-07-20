import { createFileRoute } from "@tanstack/react-router"

import { EntitlementsPage } from "@/features/catalog/components/entitlements-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/entitlements",
)({
  component: CatalogEntitlementsRoute,
})

function CatalogEntitlementsRoute() {
  const { organizationId, projectId } = Route.useParams()

  return <EntitlementsPage organizationId={organizationId} projectId={projectId} />
}
