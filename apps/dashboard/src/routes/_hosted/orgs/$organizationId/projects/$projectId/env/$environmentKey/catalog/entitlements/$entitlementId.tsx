import { createFileRoute } from "@tanstack/react-router"

import { EntitlementDetailPage } from "@/features/catalog/components/entitlement-detail-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/entitlements/$entitlementId",
)({
  component: CatalogEntitlementRoute,
  head: () => routeHead({ title: "Entitlement" }),
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
