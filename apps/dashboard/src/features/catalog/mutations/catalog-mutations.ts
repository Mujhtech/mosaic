import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import {
  addPlanProduct,
  addProductEntitlement,
  archiveProduct,
  createEntitlement,
  createPlan,
  createProduct,
  createProviderMapping,
  removePlanProduct,
  removeProductEntitlement,
  restoreProduct,
  setProductReplacement,
  type CreateCatalogResourceRequest,
  type CreateProductRequest,
  type CreateProviderMappingRequest,
} from "@/generated/api"
import {
  invalidateCatalogImpact,
  replacementImpactProductIds,
} from "@/features/catalog/mutations/catalog-impact"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export function createPlanMutationOptions(projectId: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (body: CreateCatalogResourceRequest) => {
      const result = await createPlan({
        body,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () => invalidateCatalogImpact(queryClient, { projectId }),
  })
}

export function createProductMutationOptions(projectId: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (body: CreateProductRequest) => {
      const result = await createProduct({
        body,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () => invalidateCatalogImpact(queryClient, { projectId }),
  })
}

export function createEntitlementMutationOptions(projectId: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (body: CreateCatalogResourceRequest) => {
      const result = await createEntitlement({
        body,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () => invalidateCatalogImpact(queryClient, { projectId }),
  })
}

export function addPlanProductMutationOptions(
  planId: string,
  projectId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (productId: string) => {
      const result = await addPlanProduct({
        body: { productId },
        client: generatedDashboardClient,
        path: { planId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async (_, productId) =>
      invalidateCatalogImpact(queryClient, {
        planIds: [planId],
        productIds: [productId],
        projectId,
      }),
  })
}

export function removePlanProductMutationOptions(
  planId: string,
  projectId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (productId: string) => {
      await removePlanProduct({
        client: generatedDashboardClient,
        path: { planId, productId },
        throwOnError: true,
      })
      return productId
    },
    onSuccess: async (productId) =>
      invalidateCatalogImpact(queryClient, {
        planIds: [planId],
        productIds: [productId],
        projectId,
      }),
  })
}

export function grantEntitlementMutationOptions(
  productId: string,
  projectId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (entitlementId: string) => {
      const result = await addProductEntitlement({
        body: { entitlementId },
        client: generatedDashboardClient,
        path: { productId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async (_, entitlementId) =>
      invalidateCatalogImpact(queryClient, {
        entitlementIds: [entitlementId],
        productIds: [productId],
        projectId,
      }),
  })
}

export function removeEntitlementGrantMutationOptions(
  productId: string,
  projectId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (entitlementId: string) => {
      await removeProductEntitlement({
        client: generatedDashboardClient,
        path: { entitlementId, productId },
        throwOnError: true,
      })
      return entitlementId
    },
    onSuccess: async (entitlementId) =>
      invalidateCatalogImpact(queryClient, {
        entitlementIds: [entitlementId],
        productIds: [productId],
        projectId,
      }),
  })
}

export function productLifecycleMutationOptions(
  queryClient: QueryClient,
  action: "archive" | "restore",
) {
  return mutationOptions({
    mutationFn: async (productId: string) => {
      const request = action === "archive" ? archiveProduct : restoreProduct
      const result = await request({
        client: generatedDashboardClient,
        path: { productId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async (product) =>
      invalidateCatalogImpact(queryClient, {
        productIds: [
          product.id,
          ...(product.replacementProductId ? [product.replacementProductId] : []),
        ],
        projectId: product.projectId,
      }),
  })
}

export function setProductReplacementMutationOptions(productId: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async ({ replacementProductId }: ReplacementSelection) => {
      const result = await setProductReplacement({
        body: { productId: replacementProductId },
        client: generatedDashboardClient,
        path: { productId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async (product, selection) =>
      invalidateCatalogImpact(queryClient, {
        productIds: replacementImpactProductIds(
          productId,
          selection.previousReplacementProductId,
          selection.replacementProductId,
        ),
        projectId: product.projectId,
      }),
  })
}

interface ReplacementSelection {
  previousReplacementProductId?: string
  replacementProductId: string
}

export function createProviderPlaceholderMutationOptions(
  productId: string,
  projectId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (body: CreateProviderMappingRequest) => {
      const result = await createProviderMapping({
        body,
        client: generatedDashboardClient,
        path: { productId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () =>
      invalidateCatalogImpact(queryClient, { productIds: [productId], projectId }),
  })
}
