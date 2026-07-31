import { queryOptions } from "@tanstack/react-query"

import { listEnvironments } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const environmentKeys = {
  list: (projectId: string) => ["environments", projectId] as const,
}

export function environmentsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: environmentKeys.list(projectId),
    queryFn: async ({ signal }) => {
      const result = await listEnvironments({
        client: generatedDashboardClient,
        path: { projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}
