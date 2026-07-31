import { queryOptions } from "@tanstack/react-query";

import { listProductEntitlementGrantVersions } from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

/**
 * Grant version history is Project-scoped and read by any member of the owning
 * organization: an operator who can see a customer's entitlements but not the
 * rule that produced them has been handed a fact with no explanation.
 */
export const grantVersionKeys = {
  history: (
    projectId: string,
    productId: string,
    entitlementId: string | undefined
  ) =>
    [
      "entitlement-grants",
      projectId,
      "versions",
      productId,
      entitlementId ?? "all",
    ] as const,
  scope: (projectId: string) => ["entitlement-grants", projectId] as const,
};

export function grantVersionHistoryQueryOptions(
  projectId: string,
  productId: string,
  entitlementId?: string
) {
  return queryOptions({
    queryKey: grantVersionKeys.history(projectId, productId, entitlementId),
    queryFn: async ({ signal }) => {
      const result = await listProductEntitlementGrantVersions({
        client: generatedDashboardClient,
        path: { projectId },
        query: {
          limit: 200,
          productId,
          ...(entitlementId ? { entitlementId } : {}),
        },
        signal,
        throwOnError: true,
      });
      return result.data.data?.items ?? [];
    },
  });
}
