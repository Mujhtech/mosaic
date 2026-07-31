import { queryOptions } from "@tanstack/react-query"

import { listReplayJobs, type ReplayJob } from "@/generated/api"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const replayKeys = {
  list: (projectId: string, environmentId: string) =>
    ["billing-ledger", projectId, environmentId, "replay-jobs"] as const,
}

const TERMINAL_STATUSES: readonly ReplayJob["status"][] = ["completed", "failed"]

export function replayJobsQueryOptions(projectId: string, environmentId: string) {
  return queryOptions({
    queryKey: replayKeys.list(projectId, environmentId),
    queryFn: async ({ signal }) => {
      const result = await listReplayJobs({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query: { limit: 25 },
        signal,
        throwOnError: true,
      })
      return result.data.data?.items ?? []
    },
    // Replay runs on a worker. Polling stops as soon as nothing is in flight,
    // so an idle billing page makes no repeating requests.
    refetchInterval: (query) => {
      const items = query.state.data ?? []
      const running = items.some((job) => !TERMINAL_STATUSES.includes(job.status))
      return running ? 5000 : false
    },
  })
}
