import { queryOptions } from "@tanstack/react-query"

import { listMembers } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const memberKeys = {
  list: (organizationId: string) => ["members", organizationId] as const,
}

export function membersQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: memberKeys.list(organizationId),
    queryFn: async ({ signal }) => {
      const result = await listMembers({
        client: generatedDashboardClient,
        path: { organizationId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}
