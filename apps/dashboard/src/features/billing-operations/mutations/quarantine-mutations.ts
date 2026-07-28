import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { closeQuarantineRecordSuperseded, retryQuarantinedInput } from "@/generated/api"
import { transactionKeys } from "@/features/billing-ledger/queries/transaction-queries"
import { quarantineKeys } from "@/features/billing-operations/queries/quarantine-queries"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

/**
 * The two audited quarantine operations, and only those two.
 *
 * `retryQuarantinedInput` asks the store again and appends a Validation
 * Attempt; the record closes only if that attempt succeeds.
 * `closeQuarantineRecordSuperseded` closes bookkeeping and asserts nothing
 * about the original input. There is no third mutation, because the API
 * exposes no endpoint that marks a quarantined input valid.
 */
async function invalidateQuarantine(
  queryClient: QueryClient,
  projectId: string,
  environmentId: string,
  recordId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: quarantineKeys.scope(projectId) }),
    queryClient.invalidateQueries({ queryKey: quarantineKeys.detail(projectId, recordId) }),
    queryClient.invalidateQueries({ queryKey: transactionKeys.scope(projectId, environmentId) }),
  ])
}

export function retryQuarantinedInputMutationOptions(
  projectId: string,
  environmentId: string,
  recordId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await retryQuarantinedInput({
        client: generatedDashboardClient,
        path: { projectId, recordId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSettled: async () => invalidateQuarantine(queryClient, projectId, environmentId, recordId),
  })
}

export function closeQuarantineSupersededMutationOptions(
  projectId: string,
  environmentId: string,
  recordId: string,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: async ({ supersededByRecordId }: { supersededByRecordId: string }) => {
      const result = await closeQuarantineRecordSuperseded({
        body: { supersededByRecordId },
        client: generatedDashboardClient,
        path: { projectId, recordId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSettled: async () => invalidateQuarantine(queryClient, projectId, environmentId, recordId),
  })
}
