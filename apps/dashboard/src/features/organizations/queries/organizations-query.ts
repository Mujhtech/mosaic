import { queryOptions } from "@tanstack/react-query"

import { getOrganization, listOrganizations } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const organizationKeys = {
  all: ["organizations"] as const,
  detail: (organizationId: string) => ["organizations", "detail", organizationId] as const,
  list: () => ["organizations", "list"] as const,
}

export function organizationsQueryOptions() {
  return queryOptions({
    queryKey: organizationKeys.list(),
    queryFn: async ({ signal }) => {
      const result = await listOrganizations({
        client: generatedDashboardClient,
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

export function organizationQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.detail(organizationId),
    queryFn: async ({ signal }) => {
      const result = await getOrganization({
        client: generatedDashboardClient,
        path: { organizationId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}
