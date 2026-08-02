import { queryOptions } from "@tanstack/react-query";

import { getQuarantineRecord, listBillingQuarantine } from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export interface QuarantineListFilters {
  cursor?: string;
  provider?: "app_store" | "google_play";
  reasonCode?: string;
  status?: "closed_after_success" | "closed_superseded" | "open" | "retrying";
}

export const QUARANTINE_PAGE_SIZE = 50;

export const quarantineKeys = {
  detail: (projectId: string, recordId: string) =>
    ["billing-quarantine", projectId, "detail", recordId] as const,
  list: (
    projectId: string,
    environmentId: string,
    filters: QuarantineListFilters
  ) =>
    ["billing-quarantine", projectId, environmentId, "list", filters] as const,
  scope: (projectId: string) => ["billing-quarantine", projectId] as const,
};

/**
 * One page of quarantine records, plus the cursor for the next.
 *
 * The cursor is returned rather than swallowed: a page of 50 presented as a
 * total is a correctness problem on the surface whose job is "inputs that need
 * attention". An Environment with 60 open records must not report 50.
 */
export function quarantineRecordsQueryOptions(
  projectId: string,
  environmentId: string,
  filters: QuarantineListFilters = {}
) {
  return queryOptions({
    queryKey: quarantineKeys.list(projectId, environmentId, filters),
    queryFn: async ({ signal }) => {
      const result = await listBillingQuarantine({
        client: generatedDashboardClient,
        path: { environmentId, projectId },
        query: { limit: QUARANTINE_PAGE_SIZE, ...filters },
        signal,
        throwOnError: true,
      });
      return {
        items: result.data.data?.items ?? [],
        nextCursor: result.data.data?.nextCursor,
      };
    },
  });
}

export function quarantineRecordQueryOptions(
  projectId: string,
  recordId: string
) {
  return queryOptions({
    queryKey: quarantineKeys.detail(projectId, recordId),
    queryFn: async ({ signal }) => {
      const result = await getQuarantineRecord({
        client: generatedDashboardClient,
        path: { projectId, recordId },
        signal,
        throwOnError: true,
      });
      return result.data.data;
    },
  });
}
