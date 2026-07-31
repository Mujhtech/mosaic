import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { releaseKeys } from "@/features/releases/queries/release-queries"
import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter"

export function rollbackReleaseMutationOptions(
  input: { environmentId: string; projectId: string; releaseId: string },
  adapter: HostedPublishingAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: () => adapter.rollbackRelease(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: releaseKeys.all({
          environmentId: input.environmentId,
          projectId: input.projectId,
        }),
      })
    },
  })
}
