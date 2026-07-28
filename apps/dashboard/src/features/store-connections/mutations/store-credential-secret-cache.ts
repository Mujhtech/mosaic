import type { QueryClient } from "@tanstack/react-query"

import type { StoreServerCredentialWithEndpoint } from "@/generated/api"

/**
 * Creating or rotating an Apple Store Server Credential returns the complete
 * notification endpoint URL exactly once. That URL embeds the intake token, so
 * it is a secret in the same class as an API key.
 *
 * TanStack Query keeps the last result of a mutation on its observer and in the
 * mutation cache, which would keep the URL reachable long after the operator
 * dismissed it. The value is therefore moved straight into component state and
 * scrubbed from the cache, mirroring the API-key handling.
 */

export type StoreCredentialEndpointOperation = "create" | "rotate"

export function storeCredentialEndpointMutationKey(
  projectId: string,
  operation: StoreCredentialEndpointOperation,
) {
  return ["store-connections", projectId, "one-time-endpoint", operation] as const
}

export function clearStoreCredentialSecretMutationCache(queryClient: QueryClient) {
  const mutationCache = queryClient.getMutationCache()

  for (const mutation of mutationCache.getAll()) {
    const key = mutation.options.mutationKey
    if (key?.[0] === "store-connections" && key[2] === "one-time-endpoint") {
      mutationCache.remove(mutation)
    }
  }
}

export function transferStoreCredentialEndpoint(
  queryClient: QueryClient,
  result: StoreServerCredentialWithEndpoint,
  reveal: (result: StoreServerCredentialWithEndpoint) => void,
  resetObservers: () => void,
) {
  reveal(result)
  resetObservers()
  clearStoreCredentialSecretMutationCache(queryClient)
}
