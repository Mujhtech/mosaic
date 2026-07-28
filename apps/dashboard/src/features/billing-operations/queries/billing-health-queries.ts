import { queryOptions } from "@tanstack/react-query"

import { getBillingHealth } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const billingHealthKeys = {
  detail: (projectId: string, environmentId: string) =>
    ["billing-health", projectId, environmentId] as const,
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
  })
}
