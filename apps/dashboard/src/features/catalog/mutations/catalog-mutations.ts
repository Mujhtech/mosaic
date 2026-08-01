import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import {
  invalidateCatalogImpact,
  replacementImpactProductIds,
} from "@/features/catalog/mutations/catalog-impact";
import {
  addPlanProduct,
  archiveProduct,
  archiveProviderMapping,
  type CreateCatalogResourceRequest,
  type CreateProductRequest,
  type CreateProviderMappingDraftRequest,
  createEntitlement,
  createPlan,
  createProduct,
  createProviderMappingDraft,
  type ReplaceProviderMappingRequest,
  removePlanProduct,
  replaceProviderMapping,
  restoreProduct,
  setProductReplacement,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export function createPlanMutationOptions(
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (body: CreateCatalogResourceRequest) => {
      const result = await createPlan({
        body,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () => invalidateCatalogImpact(queryClient, { projectId }),
  });
}

export function archiveProviderMappingMutationOptions(
  productId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (mappingId: string) => {
      const result = await archiveProviderMapping({
        client: generatedDashboardClient,
        path: { mappingId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () =>
      invalidateCatalogImpact(queryClient, {
        productIds: [productId],
        projectId,
      }),
  });
}

export function replaceProviderMappingMutationOptions(
  productId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async ({
      body,
      mappingId,
    }: {
      body: ReplaceProviderMappingRequest;
      mappingId: string;
    }) => {
      const result = await replaceProviderMapping({
        body,
        client: generatedDashboardClient,
        path: { mappingId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () =>
      invalidateCatalogImpact(queryClient, {
        productIds: [productId],
        projectId,
      }),
  });
}

export function createProviderMappingDraftMutationOptions(
  productId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (body: CreateProviderMappingDraftRequest) => {
      const result = await createProviderMappingDraft({
        body,
        client: generatedDashboardClient,
        path: { productId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () =>
      invalidateCatalogImpact(queryClient, {
        productIds: [productId],
        projectId,
      }),
  });
}

export function createProductMutationOptions(
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (body: CreateProductRequest) => {
      const result = await createProduct({
        body,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () => invalidateCatalogImpact(queryClient, { projectId }),
  });
}

export function createEntitlementMutationOptions(
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (body: CreateCatalogResourceRequest) => {
      const result = await createEntitlement({
        body,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () => invalidateCatalogImpact(queryClient, { projectId }),
  });
}

export function addPlanProductMutationOptions(
  planId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (productId: string) => {
      const result = await addPlanProduct({
        body: { productId },
        client: generatedDashboardClient,
        path: { planId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async (_, productId) =>
      invalidateCatalogImpact(queryClient, {
        planIds: [planId],
        productIds: [productId],
        projectId,
      }),
  });
}

export function removePlanProductMutationOptions(
  planId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (productId: string) => {
      await removePlanProduct({
        client: generatedDashboardClient,
        path: { planId, productId },
        throwOnError: true,
      });
      return productId;
    },
    onSuccess: async (productId) =>
      invalidateCatalogImpact(queryClient, {
        planIds: [planId],
        productIds: [productId],
        projectId,
      }),
  });
}

/*
 * Retired in Phase 9B.
 *
 * `grantEntitlementMutationOptions` and `removeEntitlementGrantMutationOptions`
 * changed a single mutable grant row, which meant removing an Entitlement
 * silently changed what every past purchase of the Product had meant — one
 * DELETE away from mass revocation with nothing left saying it had ever granted
 * anything. What a Product grants is now an immutable, versioned interval that
 * the projection engine selects by each purchase's own effective time, so the
 * only write path is publishing a new version:
 * `features/entitlement-grants/mutations/grant-version-mutations.ts`.
 *
 * The read (`productEntitlementsQueryOptions`) stays: Product detail still shows
 * what the Product grants today and links to the version history.
 */

export function productLifecycleMutationOptions(
  queryClient: QueryClient,
  action: "archive" | "restore"
) {
  return mutationOptions({
    mutationFn: async (productId: string) => {
      const request = action === "archive" ? archiveProduct : restoreProduct;
      const result = await request({
        client: generatedDashboardClient,
        path: { productId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async (product) =>
      invalidateCatalogImpact(queryClient, {
        productIds: [
          product.id,
          ...(product.replacementProductId
            ? [product.replacementProductId]
            : []),
        ],
        projectId: product.projectId,
      }),
  });
}

export function setProductReplacementMutationOptions(
  productId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async ({ replacementProductId }: ReplacementSelection) => {
      const result = await setProductReplacement({
        body: { productId: replacementProductId },
        client: generatedDashboardClient,
        path: { productId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async (product, selection) =>
      invalidateCatalogImpact(queryClient, {
        productIds: replacementImpactProductIds(
          productId,
          selection.previousReplacementProductId,
          selection.replacementProductId
        ),
        projectId: product.projectId,
      }),
  });
}

interface ReplacementSelection {
  previousReplacementProductId?: string;
  replacementProductId: string;
}
