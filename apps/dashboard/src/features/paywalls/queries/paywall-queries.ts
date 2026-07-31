import { queryOptions } from "@tanstack/react-query"

import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter"

export const paywallKeys = {
  all: (projectId: string, adapter?: HostedPublishingAdapter) =>
    adapter
      ? (["hosted-paywalls", projectId, adapter] as const)
      : (["hosted-paywalls", projectId] as const),
  activeDraft: (
    input: { environmentId: string; paywallId: string; projectId: string },
    adapter?: HostedPublishingAdapter,
  ) =>
    adapter
      ? (["hosted-paywalls", "active-draft", input, adapter] as const)
      : (["hosted-paywalls", "active-draft", input] as const),
  detail: (input: { paywallId: string; projectId: string }, adapter?: HostedPublishingAdapter) =>
    adapter
      ? (["hosted-paywalls", "detail", input, adapter] as const)
      : (["hosted-paywalls", "detail", input] as const),
  draft: (
    input: { draftId: string; paywallId: string; projectId: string },
    adapter?: HostedPublishingAdapter,
  ) =>
    adapter
      ? (["hosted-paywalls", "draft", input, adapter] as const)
      : (["hosted-paywalls", "draft", input] as const),
}

export function paywallsQueryOptions(projectId: string, adapter: HostedPublishingAdapter) {
  return queryOptions({
    queryKey: paywallKeys.all(projectId, adapter),
    queryFn: () => adapter.listPaywalls(projectId),
  })
}

export function paywallQueryOptions(
  input: { paywallId: string; projectId: string },
  adapter: HostedPublishingAdapter,
) {
  return queryOptions({
    queryKey: paywallKeys.detail(input, adapter),
    queryFn: () => adapter.getPaywall(input),
  })
}

export function activeHostedDraftQueryOptions(
  input: { environmentId: string; paywallId: string; projectId: string },
  adapter: HostedPublishingAdapter,
) {
  return queryOptions({
    queryKey: paywallKeys.activeDraft(input, adapter),
    queryFn: () => adapter.getActiveDraft(input),
  })
}

export function hostedDraftQueryOptions(
  input: { draftId: string; paywallId: string; projectId: string },
  adapter: HostedPublishingAdapter,
) {
  return queryOptions({
    queryKey: paywallKeys.draft(input, adapter),
    queryFn: () => adapter.getDraft(input),
  })
}
