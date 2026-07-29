import { queryOptions } from "@tanstack/react-query"

import {
  getOperatorBillingIdentityConflict,
  listOperatorBillingIdentityConflicts,
} from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

/**
 * Identity conflicts are Project-scoped, so their query keys are too.
 *
 * A Billing Customer's identity belongs to the Project while its purchases and
 * snapshots belong to an Environment. Keying these by Environment would show an
 * operator a different conflict list depending on which Environment they
 * happened to be in, which is exactly the misreading that makes someone
 * conclude a conflict has been resolved.
 */
export const conflictKeys = {
  detail: (projectId: string, conflictId: string) =>
    ["billing-conflicts", projectId, "conflict", conflictId] as const,
  list: (projectId: string, status: string) =>
    ["billing-conflicts", projectId, "conflicts", status] as const,
  scope: (projectId: string) => ["billing-conflicts", projectId] as const,
}

export function identityConflictsQueryOptions(projectId: string, status: "open" | "resolved") {
  return queryOptions({
    queryKey: conflictKeys.list(projectId, status),
    queryFn: async ({ signal }) => {
      const result = await listOperatorBillingIdentityConflicts({
        client: generatedDashboardClient,
        path: { projectId },
        query: { status },
        signal,
        throwOnError: true,
      })
      return result.data.data?.items ?? []
    },
  })
}

export function identityConflictQueryOptions(projectId: string, conflictId: string) {
  return queryOptions({
    queryKey: conflictKeys.detail(projectId, conflictId),
    queryFn: async ({ signal }) => {
      const result = await getOperatorBillingIdentityConflict({
        client: generatedDashboardClient,
        path: { conflictId, projectId },
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}
