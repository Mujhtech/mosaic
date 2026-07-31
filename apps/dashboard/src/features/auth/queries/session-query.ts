import { queryOptions } from "@tanstack/react-query"

import { getSession } from "@/generated/api/sdk.gen"
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client"

export const sessionKeys = {
  current: ["auth", "session"] as const,
}

export function sessionQueryOptions() {
  return queryOptions({
    queryKey: sessionKeys.current,
    queryFn: async ({ signal }) => {
      const result = await getSession({
        client: generatedDashboardClient,
        signal,
        throwOnError: true,
      })
      return result.data.data
    },
    retry: false,
  })
}
