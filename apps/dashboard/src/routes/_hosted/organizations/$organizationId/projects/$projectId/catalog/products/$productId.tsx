import { createFileRoute } from "@tanstack/react-router"

import { ProductDetailPage } from "@/features/catalog/components/product-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/products/$productId",
)({
  component: CatalogProductRoute,
})

function CatalogProductRoute() {
  const { organizationId, productId, projectId } = Route.useParams()

  return (
    <ProductDetailPage
      organizationId={organizationId}
      productId={productId}
      projectId={projectId}
    />
  )
}
