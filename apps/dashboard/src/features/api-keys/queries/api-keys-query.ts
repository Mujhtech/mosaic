import { queryOptions } from "@tanstack/react-query";

import { type ApiKeyKind, listApiKeys } from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export const apiKeyKeys = {
  list: (environmentId: string, kind?: ApiKeyKind) =>
    ["api-keys", environmentId, kind ?? "all"] as const,
};

export function apiKeysQueryOptions(environmentId: string, kind?: ApiKeyKind) {
  return queryOptions({
    queryKey: apiKeyKeys.list(environmentId, kind),
    queryFn: async ({ signal }) => {
      const result = await listApiKeys({
        client: generatedDashboardClient,
        path: { environmentId },
        query: { kind },
        signal,
        throwOnError: true,
      });
      return result.data.data;
    },
  });
}
