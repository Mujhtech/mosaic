import { createFileRoute } from "@tanstack/react-router"

import { EntitlementDetailPage } from "@/features/catalog/components/entitlement-detail-page"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/entitlements/$entitlementId",
)({
  component: CatalogEntitlementRoute,
})

function CatalogEntitlementRoute() {
  const { entitlementId, organizationId, projectId } = Route.useParams()

  return (
    <EntitlementDetailPage
      entitlementId={entitlementId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
