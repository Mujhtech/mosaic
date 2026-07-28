import { queryOptions } from "@tanstack/react-query"

import { getBillingProjectionHealth } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

/**
 * Projection health is a sibling of billing health, not a field on it.
 *
 * Billing health answers whether Mosaic can still turn store notifications into
 * facts. This answers whether the authoritative answer Mosaic gives about a
 * customer's access is still current. Both can be green while the other is red,
 * and merging them would let a healthy intake pipeline hide a stalled
 * projection queue — the failure mode where every fact is recorded correctly and
 * every customer is told the wrong thing.
 */
export const projectionHealthKeys = {
  detail: (projectId: string, environmentId: string) =>
    ["billing-projection", projectId, environmentId, "health"] as const,
  scope: (projectId: string, environmentId: string) =>
    ["billing-projection", projectId, environmentId] as const,
}

export function projectionHealthQueryOptions(projectId: string, environmentId: string) {
  return queryOptions({
    queryKey: projectionHealthKeys.detail(projectId, environmentId),
    queryFn: async ({ signal }) => {
      const result = await getBillingProjectionHealth({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
    // The same bounded interval billing health uses. An operator watching a
    // projection backlog should not have to reload to find out whether it is
    // draining.
    refetchInterval: 30_000,
  })
}
