import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { safeInternalReturnTo } from "@/features/auth/types/hosted-access"
import { ProductsPage } from "@/features/catalog/components/products-page"
import type { ProductFilters } from "@/features/catalog/queries/catalog-query"
import { routeHead } from "@/lib/routing/route-head"

const productStatuses = ["draft", "connected", "attention_required", "archived"] as const
const productTypes = ["subscription", "one_time_non_consumable"] as const

interface ProductsSearch extends ProductFilters {
  returnTo?: string
}

function isProductStatus(value: unknown): value is ProductFilters["status"] {
  return typeof value === "string" && productStatuses.some((status) => status === value)
}

function isProductType(value: unknown): value is ProductFilters["type"] {
  return typeof value === "string" && productTypes.some((type) => type === value)
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/products/",
)({
  component: CatalogProductsRoute,
  head: () => routeHead({ title: "Products" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): ProductsSearch => {
    // Bounded to same-origin paths, so a recovery round trip can never be
    // rewritten into an off-origin destination.
    const returnTo = safeInternalReturnTo(search.returnTo, "")
    return {
      search:
        typeof search.search === "string" && search.search.length > 0 ? search.search : undefined,
      status: isProductStatus(search.status) ? search.status : undefined,
      type: isProductType(search.type) ? search.type : undefined,
      ...(returnTo ? { returnTo } : {}),
    }
  },
})

function CatalogProductsRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { returnTo, ...filters } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <ProductsPage
      filters={filters}
      onFiltersChange={(nextFilters) => {
        void navigate({
          replace: true,
          search: { ...nextFilters, ...(returnTo ? { returnTo } : {}) },
        })
      }}
      organizationId={organizationId}
      projectId={projectId}
      {...(returnTo ? { returnTo } : {})}
    />
  )
}
