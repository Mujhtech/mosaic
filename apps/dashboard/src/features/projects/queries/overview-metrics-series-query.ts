import { queryOptions } from "@tanstack/react-query";

import { getProjectOverviewMetricsSeries } from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export const overviewMetricsSeriesKeys = {
  detail: (projectId: string, environmentId: string, days: number) =>
    [
      "projects",
      projectId,
      "overview-metrics",
      environmentId,
      "series",
      days,
    ] as const,
};

/**
 * The daily series behind the overview chart, for one Environment and window.
 *
 * The window length is part of the key because the server clamps and echoes it:
 * two ranges are two different answers, not one answer sliced client-side.
 * Completed days do not change, so a minute of staleness costs nothing while
 * still refreshing today's accruing point often enough to stay honest.
 */
export function overviewMetricsSeriesQueryOptions(
  projectId: string,
  environmentId: string,
  days: number
) {
  return queryOptions({
    queryKey: overviewMetricsSeriesKeys.detail(projectId, environmentId, days),
    queryFn: async ({ signal }) => {
      const result = await getProjectOverviewMetricsSeries({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query: { days },
        signal,
        throwOnError: true,
      });
      return result.data.data;
    },
    staleTime: 60_000,
  });
}
