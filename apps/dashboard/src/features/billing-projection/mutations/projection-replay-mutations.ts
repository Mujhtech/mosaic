import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { createBillingProjectionReplay, type CreateProjectionReplayRequest } from "@/generated/api"
import { projectionHealthKeys } from "@/features/billing-projection/queries/projection-health-queries"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

/**
 * Replay runs synchronously and answers with its comparison, so there is no job
 * to poll. Health is invalidated afterwards because a replay that materialised
 * new snapshots moves the stale-customer and last-committed figures.
 */
export function createProjectionReplayMutationOptions(
  projectId: string,
  environmentId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (request: CreateProjectionReplayRequest) => {
      const result = await createBillingProjectionReplay({
        body: request,
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({
        queryKey: projectionHealthKeys.detail(projectId, environmentId),
      }),
  })
}
