import { queryOptions } from "@tanstack/react-query"

import { listReconciliationRuns, type ReconciliationRun } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const reconciliationKeys = {
  detail: (projectId: string, environmentId: string, runId: string) =>
    ["billing-reconciliation", projectId, environmentId, "detail", runId] as const,
  list: (projectId: string, environmentId: string, cursor: string) =>
    ["billing-reconciliation", projectId, environmentId, "list", cursor] as const,
  scope: (projectId: string, environmentId: string) =>
    ["billing-reconciliation", projectId, environmentId] as const,
}

export const RECONCILIATION_PAGE_SIZE = 25

const TERMINAL_STATUSES: readonly ReconciliationRun["status"][] = ["completed", "failed", "partial"]

export function reconciliationRunIsTerminal(run: Pick<ReconciliationRun, "status"> | undefined) {
  return run ? TERMINAL_STATUSES.includes(run.status) : false
}

export function reconciliationRunsQueryOptions(
  projectId: string,
  environmentId: string,
  cursor = "",
) {
  return queryOptions({
    queryKey: reconciliationKeys.list(projectId, environmentId, cursor),
    queryFn: async ({ signal }) => {
      const result = await listReconciliationRuns({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query: { limit: RECONCILIATION_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
        signal,
        throwOnError: true,
      })
      return {
        items: result.data.data?.items ?? [],
        nextCursor: result.data.data?.nextCursor,
      }
    },
    // Bounded polling while a run is in flight, and none once every run has
    // reached a terminal state.
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some((run) => !reconciliationRunIsTerminal(run))
        ? 5000
        : false,
  })
}

/**
 * The contract exposes no `GET .../reconciliation-runs/{runId}`, so a run is
 * resolved by walking the bounded run list. A run older than the walk renders
 * an explicit "no longer in the recent history" state.
 */
const RUN_LOOKUP_MAX_PAGES = 5
const RUN_LOOKUP_PAGE_SIZE = 100

export function reconciliationRunQueryOptions(
  projectId: string,
  environmentId: string,
  runId: string,
) {
  return queryOptions({
    queryKey: reconciliationKeys.detail(projectId, environmentId, runId),
    queryFn: async ({ signal }): Promise<ReconciliationRun | null> => {
      let cursor: string | undefined
      for (let page = 0; page < RUN_LOOKUP_MAX_PAGES; page += 1) {
        const result = await listReconciliationRuns({
          client: generatedDashboardClient,
          path: { environmentId, projectId },
          query: { limit: RUN_LOOKUP_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
          signal,
          throwOnError: true,
        })
        const match = result.data.data?.items?.find((item) => item.id === runId)
        if (match) return match
        cursor = result.data.data?.nextCursor
        if (!cursor) break
      }
      return null
    },
    refetchInterval: (query) =>
      query.state.data && !reconciliationRunIsTerminal(query.state.data) ? 5000 : false,
  })
}
