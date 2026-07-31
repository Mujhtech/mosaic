import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { EntitlementsPage } from "@/features/catalog/components/entitlements-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/entitlements/",
)({
  component: CatalogEntitlementsRoute,
  head: () => routeHead({ title: "Entitlements" }),
  pendingComponent: RoutePendingState,
})

function CatalogEntitlementsRoute() {
  const { organizationId, projectId } = Route.useParams()

  return <EntitlementsPage organizationId={organizationId} projectId={projectId} />
}
