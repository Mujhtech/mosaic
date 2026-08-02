import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { reconciliationKeys } from "@/features/billing-operations/queries/reconciliation-queries";
import {
  type CreateReconciliationRunRequest,
  createReconciliationRun,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

/**
 * Reconciliation is restart-safe and idempotent: discovered inputs enter the
 * same deduplication pipeline as live ones. Recovery from a partial run is
 * therefore a *new* run over the remaining window, never a mutation of the
 * previous one — and the API offers no update or cancel operation to build one
 * from.
 */
export function createReconciliationRunMutationOptions(
  projectId: string,
  environmentId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (body: CreateReconciliationRunRequest) => {
      const result = await createReconciliationRun({
        body,
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: reconciliationKeys.scope(projectId, environmentId),
      });
    },
  });
}
