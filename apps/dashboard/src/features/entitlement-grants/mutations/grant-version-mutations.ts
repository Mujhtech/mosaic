import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import {
  previewProductEntitlementGrantImpact,
  publishProductEntitlementGrantVersion,
  type PublishGrantVersionRequest,
} from "@/generated/api"
import { grantVersionKeys } from "@/features/entitlement-grants/queries/grant-version-queries"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

/**
 * Preview writes nothing — not even an audit event.
 *
 * That is deliberate on the API side and it is why this is a mutation rather
 * than a query: an operator comparing three candidate policies before choosing
 * one has not made three changes, so the result is never cached under a key
 * that could be mistaken for committed state.
 */
export function previewGrantImpactMutationOptions(projectId: string) {
  return mutationOptions({
    mutationFn: async (request: PublishGrantVersionRequest) => {
      const result = await previewProductEntitlementGrantImpact({
        body: request,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      })
      return result.data.data
    },
  })
}

/**
 * The only call on this surface that changes what a Product grants.
 *
 * Publishing closes the current version at exactly the new version's start, so
 * the intervals abut, and the same server transaction enqueues a reprojection
 * for every Billing Customer whose current snapshot cites the Product. The
 * history query is invalidated on success because the previously open interval
 * has just been closed.
 */
export function publishGrantVersionMutationOptions(projectId: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (request: PublishGrantVersionRequest) => {
      const result = await publishProductEntitlementGrantVersion({
        body: request,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: grantVersionKeys.scope(projectId) }),
  })
}
