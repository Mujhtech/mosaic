import { queryOptions } from "@tanstack/react-query"

import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter"

export const releaseKeys = {
  all: (input: { environmentId: string; projectId: string }, adapter?: HostedPublishingAdapter) =>
    adapter
      ? (["configuration-releases", input, adapter] as const)
      : (["configuration-releases", input] as const),
}

export function releasesQueryOptions(
  input: { environmentId: string; projectId: string },
  adapter: HostedPublishingAdapter,
) {
  return queryOptions({
    queryKey: releaseKeys.all(input, adapter),
    queryFn: () => adapter.listReleases(input),
  })
}
