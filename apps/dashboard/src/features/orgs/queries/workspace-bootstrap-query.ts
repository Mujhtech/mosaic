import { queryOptions } from "@tanstack/react-query"

import { getWorkspaceBootstrap } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const workspaceBootstrapKeys = {
  all: ["workspace-bootstrap"] as const,
}

/**
 * One read that answers both "which Organizations does this operator have?" and
 * "what is in them?". Entry and the Organization switcher share it, so opening
 * the switcher costs nothing and entry resolves without a request per
 * Organization.
 */
export function workspaceBootstrapQueryOptions() {
  return queryOptions({
    queryKey: workspaceBootstrapKeys.all,
    queryFn: async ({ signal }) => {
      const result = await getWorkspaceBootstrap({
        client: generatedDashboardClient,
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
  })
}
