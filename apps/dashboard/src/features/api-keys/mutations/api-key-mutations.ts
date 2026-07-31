import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { createApiKey, revokeApiKey, rotateApiKey, type CreateApiKeyRequest } from "@/generated/api"
import { apiKeySecretMutationKey } from "@/features/api-keys/mutations/api-key-secret-cache"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export type ApiKeyCreationInput = CreateApiKeyRequest

export function buildApiKeyCreationInput(
  kind: CreateApiKeyRequest["kind"],
  applicationId?: string,
): ApiKeyCreationInput {
  if (kind === "public_sdk") {
    if (!applicationId) throw new Error("Select an Application for this analytics-capable SDK key.")
    return { kind, applicationId }
  }
  return { kind }
}

export function createApiKeyMutationOptions(environmentId: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: apiKeySecretMutationKey(environmentId, "create"),
    mutationFn: async (input: ApiKeyCreationInput) => {
      const result = await createApiKey({
        body: input,
        client: generatedDashboardClient,
        path: { environmentId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["api-keys", environmentId] }),
  })
}

export function rotateApiKeyMutationOptions(environmentId: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationKey: apiKeySecretMutationKey(environmentId, "rotate"),
    mutationFn: async (apiKeyId: string) => {
      const result = await rotateApiKey({
        client: generatedDashboardClient,
        path: { apiKeyId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["api-keys", environmentId] }),
  })
}

export function revokeApiKeyMutationOptions(environmentId: string, queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (apiKeyId: string) => {
      const result = await revokeApiKey({
        client: generatedDashboardClient,
        path: { apiKeyId },
        throwOnError: true,
      })
      return result.data.data
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["api-keys", environmentId] }),
  })
}
