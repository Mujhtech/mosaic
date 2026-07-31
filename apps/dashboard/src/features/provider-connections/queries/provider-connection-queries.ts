import { queryOptions } from "@tanstack/react-query"

import { getActiveProviderAssignment, listProviderConnections } from "@/generated/api"
import { ApiError } from "@/lib/api/errors"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const providerConnectionKeys = {
  activeAssignment: (environmentId: string, applicationId: string) =>
    ["provider-connections", "active-assignment", environmentId, applicationId] as const,
  list: (projectId: string) => ["provider-connections", "list", projectId] as const,
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
