import { queryOptions } from "@tanstack/react-query"

import {
  getEntitlement,
  getPlan,
  getProduct,
  getProductReadiness,
  getProductUsage,
  getProviderMappingMetadata,
  listEntitlements,
  listPlanProducts,
  listPlans,
  listProductEntitlements,
  listProducts,
  listProviderMappings,
  type ProductStatus,
  type ProductType,
} from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const catalogKeys = {
  all: (projectId: string) => ["catalog", projectId] as const,
  entitlement: (entitlementId: string) => ["catalog", "entitlement", entitlementId] as const,
  entitlements: (projectId: string) => ["catalog", projectId, "entitlements"] as const,
  plan: (planId: string) => ["catalog", "plan", planId] as const,
  planProducts: (planId: string) => ["catalog", "plan", planId, "products"] as const,
  plans: (projectId: string) => ["catalog", projectId, "plans"] as const,
  product: (productId: string) => ["catalog", "product", productId] as const,
  productEntitlements: (productId: string) =>
    ["catalog", "product", productId, "entitlements"] as const,
  productReadiness: (productId: string, environmentId: string, applicationId: string) =>
    ["catalog", "product", productId, "readiness", environmentId, applicationId] as const,
  productUsage: (productId: string) => ["catalog", "product", productId, "usage"] as const,
  products: (projectId: string, filters: ProductFilters = {}) =>
    ["catalog", projectId, "products", filters] as const,
  providerMappings: (productId: string) =>
    ["catalog", "product", productId, "provider-mappings"] as const,
  providerMetadata: (mappingId: string) =>
    ["catalog", "provider-mapping", mappingId, "metadata"] as const,
}

export function providerMappingMetadataQueryOptions(mappingId: string) {
  return queryOptions({
    queryKey: catalogKeys.providerMetadata(mappingId),
    queryFn: async ({ signal }) => {
      const result = await getProviderMappingMetadata({
        client: generatedDashboardClient,
        path: { mappingId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export interface ProductFilters {
  search?: string
  status?: ProductStatus
  type?: ProductType
}

export function plansQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: catalogKeys.plans(projectId),
    queryFn: async ({ signal }) => {
      const result = await listPlans({
        client: generatedDashboardClient,
        path: { projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function planQueryOptions(planId: string) {
  return queryOptions({
    queryKey: catalogKeys.plan(planId),
    queryFn: async ({ signal }) => {
      const result = await getPlan({
        client: generatedDashboardClient,
        path: { planId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function planProductsQueryOptions(planId: string) {
  return queryOptions({
    queryKey: catalogKeys.planProducts(planId),
    queryFn: async ({ signal }) => {
      const result = await listPlanProducts({
        client: generatedDashboardClient,
        path: { planId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function productsQueryOptions(projectId: string, filters: ProductFilters = {}) {
  return queryOptions({
    queryKey: catalogKeys.products(projectId, filters),
    queryFn: async ({ signal }) => {
      const result = await listProducts({
        client: generatedDashboardClient,
        path: { projectId },
        query: filters,
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function productQueryOptions(productId: string) {
  return queryOptions({
    queryKey: catalogKeys.product(productId),
    queryFn: async ({ signal }) => {
      const result = await getProduct({
        client: generatedDashboardClient,
        path: { productId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function productUsageQueryOptions(productId: string) {
  return queryOptions({
    queryKey: catalogKeys.productUsage(productId),
    queryFn: async ({ signal }) => {
      const result = await getProductUsage({
        client: generatedDashboardClient,
        path: { productId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function productReadinessQueryOptions(
  productId: string,
  environmentId: string,
  applicationId: string,
) {
  return queryOptions({
    queryKey: catalogKeys.productReadiness(productId, environmentId, applicationId),
    queryFn: async ({ signal }) => {
      const result = await getProductReadiness({
        client: generatedDashboardClient,
        path: { productId },
        query: { applicationId, environmentId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function providerMappingsQueryOptions(productId: string) {
  return queryOptions({
    queryKey: catalogKeys.providerMappings(productId),
    queryFn: async ({ signal }) => {
      const result = await listProviderMappings({
        client: generatedDashboardClient,
        path: { productId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function entitlementsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: catalogKeys.entitlements(projectId),
    queryFn: async ({ signal }) => {
      const result = await listEntitlements({
        client: generatedDashboardClient,
        path: { projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function entitlementQueryOptions(entitlementId: string) {
  return queryOptions({
    queryKey: catalogKeys.entitlement(entitlementId),
    queryFn: async ({ signal }) => {
      const result = await getEntitlement({
        client: generatedDashboardClient,
        path: { entitlementId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function productEntitlementsQueryOptions(productId: string) {
  return queryOptions({
    queryKey: catalogKeys.productEntitlements(productId),
    queryFn: async ({ signal }) => {
      const result = await listProductEntitlements({
        client: generatedDashboardClient,
        path: { productId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}
