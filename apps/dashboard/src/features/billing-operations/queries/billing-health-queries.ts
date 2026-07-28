import { queryOptions } from "@tanstack/react-query"

import { getBillingHealth } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const billingHealthKeys = {
  detail: (projectId: string, environmentId: string) =>
    ["billing-health", projectId, environmentId] as const,
  scope: (projectId: string) => ["billing-health", projectId] as const,
}

export function billingHealthQueryOptions(projectId: string, environmentId: string) {
  return queryOptions({
    queryKey: billingHealthKeys.detail(projectId, environmentId),
    queryFn: async ({ signal }) => {
      const result = await getBillingHealth({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
    // Health is an operational view of a live queue. It refreshes on a bounded
    // interval so an operator watching a validation backlog is not reloading
    // the page to find out whether it is draining.
    refetchInterval: 30_000,
  })
}
