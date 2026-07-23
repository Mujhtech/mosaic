import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import { releaseKeys } from "@/features/releases/queries/release-queries"
import { paywallKeys } from "@/features/paywalls/queries/paywall-queries"
import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter"

export function publishDraftMutationOptions(
  input: {
    acknowledgeMockProducts: boolean
    draftId: string
    environmentId: string
    expectedRevision: number
    paywallId: string
    projectId: string
  },
  adapter: HostedPublishingAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: () => adapter.publishDraft(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: releaseKeys.all({
            environmentId: input.environmentId,
            projectId: input.projectId,
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: paywallKeys.activeDraft({
            environmentId: input.environmentId,
            paywallId: input.paywallId,
            projectId: input.projectId,
          }),
        }),
      ])
    },
  })
}
