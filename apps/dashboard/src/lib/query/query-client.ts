import { QueryClient } from "@tanstack/react-query"

import { ApiError } from "@/lib/api/errors"

function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= 2) {
    return false
  }

  return error instanceof ApiError ? error.retryable : true
}

export function createDashboardQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        gcTime: 5 * 60 * 1000,
        retry: shouldRetryQuery,
        staleTime: 30 * 1000,
      },
    },
  })
}
