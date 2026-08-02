import type { QueryClient } from "@tanstack/react-query";

import type { ApiKeySecretResult } from "@/generated/api";

export type ApiKeySecretOperation = "create" | "rotate";

export function apiKeySecretMutationKey(
  environmentId: string,
  operation: ApiKeySecretOperation
) {
  return ["api-keys", environmentId, "one-time-secret", operation] as const;
}

export function clearApiKeySecretMutationCache(queryClient: QueryClient) {
  const mutationCache = queryClient.getMutationCache();

  for (const mutation of mutationCache.getAll()) {
    const key = mutation.options.mutationKey;
    if (key?.[0] === "api-keys" && key[2] === "one-time-secret") {
      mutationCache.remove(mutation);
    }
  }
}

export function transferApiKeySecret(
  queryClient: QueryClient,
  result: ApiKeySecretResult,
  reveal: (result: ApiKeySecretResult) => void,
  resetObservers: () => void
) {
  reveal(result);
  resetObservers();
  clearApiKeySecretMutationCache(queryClient);
}
