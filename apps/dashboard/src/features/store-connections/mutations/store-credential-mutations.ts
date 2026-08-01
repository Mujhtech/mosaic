import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { storeCredentialEndpointMutationKey } from "@/features/store-connections/mutations/store-credential-secret-cache";
import { storeConnectionKeys } from "@/features/store-connections/queries/store-connection-queries";
import {
  type CreateStoreServerCredentialRequest,
  createStoreServerCredential,
  revokeStoreServerCredential,
  rotateStoreServerCredential,
  type StoreServerCredentialWithEndpoint,
  testStoreServerCredential,
} from "@/generated/api";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";

async function invalidateStoreCredentials(
  queryClient: QueryClient,
  projectId: string,
  credentialId?: string
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: storeConnectionKeys.list(projectId),
    }),
    ...(credentialId
      ? [
          queryClient.invalidateQueries({
            queryKey: storeConnectionKeys.detail(projectId, credentialId),
          }),
        ]
      : []),
  ]);
}

/**
 * The response carries the one-time notification endpoint URL. Callers must
 * hand the result to `transferStoreCredentialEndpoint`, which moves it into
 * local state and scrubs the mutation cache.
 */
export function createStoreCredentialMutationOptions(
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationKey: storeCredentialEndpointMutationKey(projectId, "create"),
    mutationFn: async (
      body: CreateStoreServerCredentialRequest
    ): Promise<StoreServerCredentialWithEndpoint> => {
      const result = await createStoreServerCredential({
        body,
        client: generatedDashboardClient,
        path: { projectId },
        throwOnError: true,
      });
      const credential = result.data.data;
      if (!credential) {
        throw new Error(
          "The API accepted the credential but returned no record."
        );
      }
      return credential;
    },
    onSettled: async () => invalidateStoreCredentials(queryClient, projectId),
  });
}

export function rotateStoreCredentialMutationOptions(
  credentialId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationKey: storeCredentialEndpointMutationKey(projectId, "rotate"),
    mutationFn: async ({
      secret,
    }: {
      secret: string;
    }): Promise<StoreServerCredentialWithEndpoint> => {
      const result = await rotateStoreServerCredential({
        body: { secret },
        client: generatedDashboardClient,
        path: { credentialId, projectId },
        throwOnError: true,
      });
      const credential = result.data.data;
      if (!credential) {
        throw new Error(
          "The API rotated the credential but returned no record."
        );
      }
      return credential;
    },
    onSettled: async () =>
      invalidateStoreCredentials(queryClient, projectId, credentialId),
  });
}

export function revokeStoreCredentialMutationOptions(
  credentialId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await revokeStoreServerCredential({
        client: generatedDashboardClient,
        path: { credentialId, projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSettled: async () =>
      invalidateStoreCredentials(queryClient, projectId, credentialId),
  });
}

export function testStoreCredentialMutationOptions(
  credentialId: string,
  projectId: string,
  queryClient: QueryClient
) {
  return mutationOptions({
    mutationFn: async () => {
      const result = await testStoreServerCredential({
        client: generatedDashboardClient,
        path: { credentialId, projectId },
        throwOnError: true,
      });
      return result.data.data;
    },
    onSettled: async () =>
      invalidateStoreCredentials(queryClient, projectId, credentialId),
  });
}
