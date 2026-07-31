import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { GrantVersionsPage } from "@/features/entitlement-grants/components/grant-versions-page"
import { routeHead } from "@/lib/routing/route-head"

interface GrantVersionsSearch {
  entitlementId?: string
  productId?: string
}

function readIdentifier(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/grant-versions",
)({
  component: GrantVersionsRoute,
  head: () => routeHead({ title: "Grant versions" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): GrantVersionsSearch => ({
    entitlementId: readIdentifier(search.entitlementId),
    productId: readIdentifier(search.productId),
  }),
})

function GrantVersionsRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { entitlementId, productId } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <GrantVersionsPage
      {...(entitlementId ? { entitlementId } : {})}
      onScopeChange={(scope) => {
        void navigate({
          replace: true,
          search: {
            ...(scope.entitlementId ? { entitlementId: scope.entitlementId } : {}),
            ...(scope.productId ? { productId: scope.productId } : {}),
          },
        })
      }}
      organizationId={organizationId}
      {...(productId ? { productId } : {})}
      projectId={projectId}
    />
  )
}
