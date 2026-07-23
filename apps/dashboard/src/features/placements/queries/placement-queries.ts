import { queryOptions } from "@tanstack/react-query"

import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter"

export const placementKeys = {
  list: (input: { environmentId: string; projectId: string }, adapter?: HostedPublishingAdapter) =>
    adapter
      ? (["placements", input.projectId, input.environmentId, adapter] as const)
      : (["placements", input.projectId, input.environmentId] as const),
}

export function placementsQueryOptions(
  input: { environmentId: string; projectId: string },
  adapter: HostedPublishingAdapter,
) {
  return queryOptions({
    queryKey: placementKeys.list(input, adapter),
    queryFn: () => adapter.listPlacements(input),
  })
}
