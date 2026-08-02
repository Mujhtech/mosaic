import { queryOptions } from "@tanstack/react-query";

import {
  getStoreServerCredential,
  listStoreServerCredentials,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

export const storeConnectionKeys = {
  all: (projectId: string) => ["store-connections", projectId] as const,
  detail: (projectId: string, credentialId: string) =>
    ["store-connections", projectId, "detail", credentialId] as const,
  list: (projectId: string) =>
    ["store-connections", projectId, "list"] as const,
};

export function storeCredentialsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: storeConnectionKeys.list(projectId),
    queryFn: async ({ signal }) => {
      const result = await listStoreServerCredentials({
        client: generatedDashboardClient,
        path: { projectId },
        signal,
        throwOnError: true,
      });
      return result.data.data?.items ?? [];
    },
  });
}

export function storeCredentialQueryOptions(
  projectId: string,
  credentialId: string
) {
  return queryOptions({
    queryKey: storeConnectionKeys.detail(projectId, credentialId),
    queryFn: async ({ signal }) => {
      const result = await getStoreServerCredential({
        client: generatedDashboardClient,
        path: { credentialId, projectId },
        signal,
        throwOnError: true,
      });
      return result.data.data;
    },
  });
}
