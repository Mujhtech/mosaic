import { queryOptions } from "@tanstack/react-query"

import { getHealth } from "@/generated/api/sdk.gen"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const diagnosticsKeys = {
  apiHealth: ["diagnostics", "api-health"] as const,
}

/**
 * Liveness probe used only by the diagnostics panel. It is deliberately not
 * retried and not refetched in the background: its purpose is to answer "can
 * this browser reach the configured API right now", once, on request.
 */
export function apiHealthQueryOptions() {
  return queryOptions({
    gcTime: 0,
    queryKey: diagnosticsKeys.apiHealth,
    queryFn: async ({ signal }) => {
      const result = await getHealth({
        client: generatedDashboardClient,
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
    retry: false,
    staleTime: 0,
  })
}
