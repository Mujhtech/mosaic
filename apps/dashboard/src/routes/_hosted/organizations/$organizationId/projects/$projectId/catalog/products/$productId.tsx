import { createFileRoute } from "@tanstack/react-router"

import { ProductDetailPage } from "@/features/catalog/components/product-detail-page"

interface ProductReadinessSearch {
  applicationId?: string
  environmentId?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/products/$productId",
)({
  component: CatalogProductRoute,
  validateSearch: (search: Record<string, unknown>): ProductReadinessSearch => ({
    applicationId:
      typeof search.applicationId === "string" && search.applicationId.length > 0
        ? search.applicationId
        : undefined,
    environmentId:
      typeof search.environmentId === "string" && search.environmentId.length > 0
        ? search.environmentId
        : undefined,
  }),
})

function CatalogProductRoute() {
  const { organizationId, productId, projectId } = Route.useParams()
  const { applicationId, environmentId } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <ProductDetailPage
      onReadinessScopeChange={(scope) => {
        void navigate({ replace: true, search: scope })
      }}
      organizationId={organizationId}
      productId={productId}
      projectId={projectId}
      readinessApplicationId={applicationId}
      readinessEnvironmentId={environmentId}
    />
  )
}
