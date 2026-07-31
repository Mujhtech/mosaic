import { queryOptions } from "@tanstack/react-query"

import {
  getActivePaywallDraft,
  getActiveProviderAssignment,
  getProviderConnection,
  getProviderConnectionCapabilities,
  getProviderConnectionHealth,
  listProviderConnectionDiagnostics,
  listProviderConnections,
  listProviderSyncRuns,
  listProducts,
  listProviderMappings,
  listPaywalls,
  previewProviderCatalog,
} from "@/generated/api"
import { ApiError } from "@/lib/api/errors"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const providerConnectionKeys = {
  activeAssignment: (environmentId: string, applicationId: string) =>
    ["provider-connections", "active-assignment", environmentId, applicationId] as const,
  capabilities: (connectionId: string) =>
    ["provider-connections", "capabilities", connectionId] as const,
  catalogPreview: (connectionId: string) =>
    ["provider-connections", "catalog-preview", connectionId] as const,
  detail: (connectionId: string) => ["provider-connections", "detail", connectionId] as const,
  diagnostics: (connectionId: string) =>
    ["provider-connections", "diagnostics", connectionId] as const,
  health: (connectionId: string) => ["provider-connections", "health", connectionId] as const,
  list: (projectId: string) => ["provider-connections", "list", projectId] as const,
  replacementImpact: (
    projectId: string,
    connectionId: string,
    environmentId: string,
    applicationId: string,
  ) =>
    [
      "provider-connections",
      "replacement-impact",
      projectId,
      connectionId,
      environmentId,
      applicationId,
    ] as const,
  syncRuns: (connectionId: string) => ["provider-connections", "sync-runs", connectionId] as const,
}

export function providerDocumentReferencesProducts(
  value: unknown,
  productIds: ReadonlySet<string>,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => providerDocumentReferencesProducts(item, productIds))
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, item]) =>
        (key === "productId" && typeof item === "string" && productIds.has(item)) ||
        (key === "productIds" &&
          Array.isArray(item) &&
          item.some((productId) => typeof productId === "string" && productIds.has(productId))) ||
        providerDocumentReferencesProducts(item, productIds),
    )
  }
  return false
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  transform: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        results[index] = await transform(items[index]!)
      }
    }),
  )
  return results
}

export function providerAssignmentImpactQueryOptions(input: {
  applicationId: string
  connectionId: string
  environmentId: string
  projectId: string
}) {
  return queryOptions({
    queryKey: providerConnectionKeys.replacementImpact(
      input.projectId,
      input.connectionId,
      input.environmentId,
      input.applicationId,
    ),
    queryFn: async ({ signal }) => {
      const productsResult = await listProducts({
        client: generatedDashboardClient,
        path: { projectId: input.projectId },
        signal,
        throwOnError: true,
      })
      const products = productsResult.data.data.items
      const mappingResults = await mapWithConcurrency(products, 6, async (product) => {
        const result = await listProviderMappings({
          client: generatedDashboardClient,
          path: { productId: product.id },
          signal,
          throwOnError: true,
        })
        return { mappings: result.data.data.items, product }
      })
      const affectedProducts = mappingResults
        .filter(({ mappings }) =>
          mappings.some(
            (mapping) =>
              mapping.connectionId === input.connectionId &&
              mapping.applicationId === input.applicationId &&
              (!mapping.environmentId || mapping.environmentId === input.environmentId) &&
              mapping.status !== "archived",
          ),
        )
        .map(({ product }) => product)
      const affectedProductIds = new Set(affectedProducts.map((product) => product.id))

      const paywallsResult = await listPaywalls({
        client: generatedDashboardClient,
        path: { projectId: input.projectId },
        signal,
        throwOnError: true,
      })
      const paywalls = await mapWithConcurrency(
        paywallsResult.data.data.items,
        6,
        async (paywall) => {
          try {
            const draft = await getActivePaywallDraft({
              client: generatedDashboardClient,
              path: { paywallId: paywall.id, projectId: input.projectId },
              query: { environmentId: input.environmentId },
              signal,
              throwOnError: true,
            })
            return providerDocumentReferencesProducts(draft.data.data.document, affectedProductIds)
              ? paywall
              : null
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) return null
            throw error
          }
        },
      )

      return {
        paywalls: paywalls.filter((paywall) => paywall !== null),
        products: affectedProducts,
      }
    },
  })
}

export function providerConnectionsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: providerConnectionKeys.list(projectId),
    queryFn: async ({ signal }) => {
      const result = await listProviderConnections({
        client: generatedDashboardClient,
        path: { projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function providerConnectionQueryOptions(connectionId: string) {
  return queryOptions({
    queryKey: providerConnectionKeys.detail(connectionId),
    queryFn: async ({ signal }) => {
      const result = await getProviderConnection({
        client: generatedDashboardClient,
        path: { connectionId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function providerConnectionHealthQueryOptions(connectionId: string) {
  return queryOptions({
    queryKey: providerConnectionKeys.health(connectionId),
    queryFn: async ({ signal }) => {
      const result = await getProviderConnectionHealth({
        client: generatedDashboardClient,
        path: { connectionId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function providerConnectionCapabilitiesQueryOptions(connectionId: string) {
  return queryOptions({
    queryKey: providerConnectionKeys.capabilities(connectionId),
    queryFn: async ({ signal }) => {
      const result = await getProviderConnectionCapabilities({
        client: generatedDashboardClient,
        path: { connectionId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function providerConnectionDiagnosticsQueryOptions(connectionId: string) {
  return queryOptions({
    queryKey: providerConnectionKeys.diagnostics(connectionId),
    queryFn: async ({ signal }) => {
      const result = await listProviderConnectionDiagnostics({
        client: generatedDashboardClient,
        path: { connectionId },
        signal,
        throwOnError: true,
      })
      return result.data.data.items
    },
  })
}

export function providerCatalogPreviewQueryOptions(connectionId: string) {
  return queryOptions({
    queryKey: providerConnectionKeys.catalogPreview(connectionId),
    queryFn: async ({ signal }) => {
      const result = await previewProviderCatalog({
        client: generatedDashboardClient,
        path: { connectionId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function providerSyncRunsQueryOptions(connectionId: string) {
  return queryOptions({
    queryKey: providerConnectionKeys.syncRuns(connectionId),
    queryFn: async ({ signal }) => {
      const result = await listProviderSyncRuns({
        client: generatedDashboardClient,
        path: { connectionId },
        signal,
        throwOnError: true,
      })
      return result.data.data.items
    },
  })
}

export function activeProviderAssignmentQueryOptions(environmentId: string, applicationId: string) {
  return queryOptions({
    queryKey: providerConnectionKeys.activeAssignment(environmentId, applicationId),
    queryFn: async ({ signal }) => {
      try {
        const result = await getActiveProviderAssignment({
          client: generatedDashboardClient,
          path: { applicationId, environmentId },
          signal,
          throwOnError: true,
        })
        return result.data.data
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
  })
}
