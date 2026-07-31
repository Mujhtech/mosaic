import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { conflictKeys } from "@/features/billing-customers/queries/conflict-queries";
import {
  type ResolveIdentityConflictRequest,
  resolveBillingIdentityConflict,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

/**
 * Record an operator's resolution of an identity conflict.
 *
 * This moves real purchases between real people and unfreezes projection for
 * both parties, so it is the one write on the customer surfaces and it carries
 * a required reason. Every customer read in the Project is invalidated
 * afterwards, not just the two named: a resolution unfreezes lineages whose
 * reprojection can change what any customer citing the same Product is shown.
 */
export function resolveIdentityConflictMutationOptions(
  projectId: string,
  conflictId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async (request: ResolveIdentityConflictRequest) => {
      const result = await resolveBillingIdentityConflict({
        body: request,
        client: generatedDashboardClient,
        path: { conflictId, projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: conflictKeys.scope(projectId),
      });
      await queryClient.invalidateQueries({ queryKey: ["billing-customers"] });
    },
  });
}
