import type { QueryClient, QueryKey } from "@tanstack/react-query"

import { catalogKeys } from "@/features/catalog/queries/catalog-query"

interface CatalogImpact {
  entitlementIds?: readonly string[]
  planIds?: readonly string[]
  productIds?: readonly string[]
  projectId: string
}

export function catalogImpactKeys({
  entitlementIds = [],
  planIds = [],
  productIds = [],
  projectId,
}: CatalogImpact): QueryKey[] {
  return [
    catalogKeys.all(projectId),
    ...planIds.map((planId) => catalogKeys.plan(planId)),
    ...productIds.map((productId) => catalogKeys.product(productId)),
    ...entitlementIds.map((entitlementId) => catalogKeys.entitlement(entitlementId)),
  ]
}

export async function invalidateCatalogImpact(queryClient: QueryClient, impact: CatalogImpact) {
  await Promise.all(
    catalogImpactKeys(impact).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  )
}

export function replacementImpactProductIds(
  sourceProductId: string,
  previousReplacementProductId: string | undefined,
  nextReplacementProductId: string,
) {
  return [
    ...new Set([sourceProductId, previousReplacementProductId, nextReplacementProductId]),
  ].filter((productId): productId is string => Boolean(productId))
}
