import { createFileRoute } from "@tanstack/react-router"

import { ProductsPage } from "@/features/catalog/components/products-page"
import type { ProductFilters } from "@/features/catalog/queries/catalog-query"

const productStatuses = ["draft", "connected", "attention_required", "archived"] as const
const productTypes = ["subscription", "one_time_non_consumable"] as const

function isProductStatus(value: unknown): value is ProductFilters["status"] {
  return typeof value === "string" && productStatuses.some((status) => status === value)
}

function isProductType(value: unknown): value is ProductFilters["type"] {
  return typeof value === "string" && productTypes.some((type) => type === value)
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/products",
)({
  component: CatalogProductsRoute,
  validateSearch: (search: Record<string, unknown>): ProductFilters => ({
    search:
      typeof search.search === "string" && search.search.length > 0 ? search.search : undefined,
    status: isProductStatus(search.status) ? search.status : undefined,
    type: isProductType(search.type) ? search.type : undefined,
  }),
})

function CatalogProductsRoute() {
  const { organizationId, projectId } = Route.useParams()
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <ProductsPage
      filters={filters}
      onFiltersChange={(nextFilters) => {
        void navigate({ replace: true, search: nextFilters })
      }}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
