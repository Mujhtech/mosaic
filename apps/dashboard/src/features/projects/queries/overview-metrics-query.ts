import { queryOptions } from "@tanstack/react-query";

import { getProjectOverviewMetrics } from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export const overviewMetricsKeys = {
  detail: (projectId: string, environmentId: string) =>
    ["projects", projectId, "overview-metrics", environmentId] as const,
};

/**
 * "Today at a glance" for one Project Environment.
 *
 * The window is the UTC day so far and the server closes it at the request
 * instant, so the response is only ever as current as the call. A short stale
 * time keeps a returning reader from staring at a window that ended minutes
 * ago, without turning an overview into a poller.
 */
export function overviewMetricsQueryOptions(
  projectId: string,
  environmentId: string
) {
  return queryOptions({
    queryKey: overviewMetricsKeys.detail(projectId, environmentId),
    queryFn: async ({ signal }) => {
      const result = await getProjectOverviewMetrics({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        signal,
        throwOnError: true,
      });
      return result.data.data;
    },
    staleTime: 30_000,
  });
}
