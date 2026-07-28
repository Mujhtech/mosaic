import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { createReplayJob, type CreateReplayJobRequest } from "@/generated/api"
import { replayKeys } from "@/features/billing-ledger/queries/replay-queries"
import { transactionKeys } from "@/features/billing-ledger/queries/transaction-queries"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

/**
 * Replay and revalidation append. There is deliberately no mutation here that
 * replaces, deletes, or accepts a previous result: the API exposes none, and
 * the UI must not imply one exists.
 */
export function createReplayJobMutationOptions(
  projectId: string,
  environmentId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async (body: CreateReplayJobRequest) => {
      const result = await createReplayJob({
        body,
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: replayKeys.list(projectId, environmentId) }),
        queryClient.invalidateQueries({
          queryKey: transactionKeys.attemptsScope(projectId, environmentId),
        }),
      ])
    },
  })
}
