import { createFileRoute } from "@tanstack/react-router"

import { ProductDetailPage } from "@/features/catalog/components/product-detail-page"
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access"

interface ProductReadinessSearch {
  applicationId?: string
  environmentId?: string
  returnTo?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/products/$productId",
)({
  component: CatalogProductRoute,
  validateSearch: (search: Record<string, unknown>): ProductReadinessSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "")
    return {
      applicationId:
        typeof search.applicationId === "string" && search.applicationId.length > 0
          ? search.applicationId
          : undefined,
      environmentId:
        typeof search.environmentId === "string" && search.environmentId.length > 0
          ? search.environmentId
          : undefined,
      ...(returnTo ? { returnTo } : {}),
    }
  },
})

function CatalogProductRoute() {
  const { organizationId, productId, projectId } = Route.useParams()
  const { applicationId, environmentId, returnTo } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <ProductDetailPage
      onReadinessScopeChange={(scope) => {
        void navigate({ replace: true, search: { ...scope, returnTo } })
      }}
      organizationId={organizationId}
      productId={productId}
      projectId={projectId}
      readinessApplicationId={applicationId}
      readinessEnvironmentId={environmentId}
      returnTo={returnTo}
    />
  )
}
