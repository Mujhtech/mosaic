import { queryOptions } from "@tanstack/react-query";
import { isRestoreJobRunning } from "@/features/billing-customers/types/restore-vocabulary";
import { getBillingRestoreJob, listBillingRestoreJobs } from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export const restoreKeys = {
  detail: (projectId: string, environmentId: string, restoreId: string) =>
    [
      "billing-restores",
      projectId,
      environmentId,
      "restore",
      restoreId,
    ] as const,
  list: (
    projectId: string,
    environmentId: string,
    filters: Record<string, unknown>
  ) =>
    [
      "billing-restores",
      projectId,
      environmentId,
      "restores",
      filters,
    ] as const,
  scope: (projectId: string, environmentId: string) =>
    ["billing-restores", projectId, environmentId] as const,
};

/**
 * Restore jobs run on a worker, so the list polls while anything is in flight
 * and stops as soon as nothing is — the same terminal-status pattern the 9A
 * replay list uses, so an idle billing page makes no repeating requests.
 *
 * Note the deliberate asymmetry with the outcome vocabulary: a job reaching
 * `completed` is what stops the polling, but a `completed` job can still carry
 * `validation_pending`, so the status and the outcome are never merged.
 */
export function restoreJobsQueryOptions(
  projectId: string,
  environmentId: string,
  filters: { billingCustomerId?: string; cursor?: string } = {}
) {
  const query = {
    limit: 25,
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    ...(filters.billingCustomerId
      ? { billingCustomerId: filters.billingCustomerId }
      : {}),
  };
  return queryOptions({
    queryKey: restoreKeys.list(projectId, environmentId, query),
    queryFn: async ({ signal }) => {
      const result = await listBillingRestoreJobs({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query,
        signal,
        throwOnError: true,
      });
      return {
        items: result.data.data?.items ?? [],
        nextCursor: result.data.data?.nextCursor,
      };
    },
    refetchInterval: (queryValue) => {
      const items = queryValue.state.data?.items ?? [];
      return items.some((job) => isRestoreJobRunning(job)) ? 5000 : false;
    },
  });
}

export function restoreJobQueryOptions(
  projectId: string,
  environmentId: string,
  restoreId: string
) {
  return queryOptions({
    queryKey: restoreKeys.detail(projectId, environmentId, restoreId),
    queryFn: async ({ signal }) => {
      const result = await getBillingRestoreJob({
        client: generatedDashboardClient,
        path: { environmentId, projectId, restoreId },
        signal,
        throwOnError: true,
      });
      return result.data.data;
    },
    refetchInterval: (query) =>
      query.state.data && isRestoreJobRunning(query.state.data) ? 5000 : false,
  });
}
