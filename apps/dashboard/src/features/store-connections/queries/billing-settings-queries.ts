import { queryOptions } from "@tanstack/react-query"

import { getBillingHealth } from "@/generated/api"
import { ApiError } from "@/lib/api/errors"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

/**
 * Whether Mosaic Billing is enabled for a Project.
 *
 * The switch itself is Project-scoped (`PUT /projects/{projectId}/billing/settings`),
 * but the contract exposes no matching read. `BillingHealth.billingEnabled`
 * reports the same Project-level flag, so the state is read by probing billing
 * health for any one Environment in the Project. Which Environment does not
 * matter — the flag is not per-Environment — so the caller passes whichever it
 * already has loaded.
 *
 * A missing or unreadable probe resolves to `null` rather than `false`: an
 * operator surface must not claim billing is off when Mosaic simply could not
 * find out. Callers render an explicit "state unavailable" branch for `null`.
 */
export const billingSettingsKeys = {
  detail: (projectId: string, probeEnvironmentId: string) =>
    ["billing-settings", projectId, probeEnvironmentId] as const,
  scope: (projectId: string) => ["billing-settings", projectId] as const,
}

export function billingSettingsQueryOptions(projectId: string, probeEnvironmentId: string) {
  return queryOptions({
    queryKey: billingSettingsKeys.detail(projectId, probeEnvironmentId),
    queryFn: async ({ signal }): Promise<{ billingEnabled: boolean | null }> => {
      try {
        const result = await getBillingHealth({
          client: generatedDashboardClient,
          path: { environmentId: probeEnvironmentId, projectId },
          signal,
          throwOnError: true,
        })
        const billingEnabled = result.data.data?.billingEnabled
        return { billingEnabled: billingEnabled ?? null }
      } catch (error) {
        // A 404 means the probe Environment is gone, not that billing is off.
        if (error instanceof ApiError && error.status === 404) return { billingEnabled: null }
        throw error
      }
    },
  })
}
