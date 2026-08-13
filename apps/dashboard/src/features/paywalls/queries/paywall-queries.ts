import { queryOptions } from "@tanstack/react-query";

import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter";

export const paywallKeys = {
  all: (projectId: string, adapter?: HostedPublishingAdapter) =>
    adapter
      ? (["hosted-paywalls", projectId, adapter] as const)
      : (["hosted-paywalls", projectId] as const),
  activeDraft: (
    input: { environmentId: string; paywallId: string; projectId: string },
    adapter?: HostedPublishingAdapter
  ) =>
    adapter
      ? (["hosted-paywalls", "active-draft", input, adapter] as const)
      : (["hosted-paywalls", "active-draft", input] as const),
  detail: (
    input: { paywallId: string; projectId: string },
    adapter?: HostedPublishingAdapter
  ) =>
    adapter
      ? (["hosted-paywalls", "detail", input, adapter] as const)
      : (["hosted-paywalls", "detail", input] as const),
  draft: (
    input: { draftId: string; paywallId: string; projectId: string },
    adapter?: HostedPublishingAdapter
  ) =>
    adapter
      ? (["hosted-paywalls", "draft", input, adapter] as const)
      : (["hosted-paywalls", "draft", input] as const),
  previewDocument: (
    input: { environmentId: string; paywallId: string; projectId: string },
    adapter?: HostedPublishingAdapter
  ) =>
    adapter
      ? (["hosted-paywalls", "preview-document", input, adapter] as const)
      : (["hosted-paywalls", "preview-document", input] as const),
};

export function paywallsQueryOptions(
  projectId: string,
  adapter: HostedPublishingAdapter
) {
  return queryOptions({
    queryKey: paywallKeys.all(projectId, adapter),
    queryFn: () => adapter.listPaywalls(projectId),
  });
}

export function paywallQueryOptions(
  input: { paywallId: string; projectId: string },
  adapter: HostedPublishingAdapter
) {
  return queryOptions({
    queryKey: paywallKeys.detail(input, adapter),
    queryFn: () => adapter.getPaywall(input),
  });
}

export function activeHostedDraftQueryOptions(
  input: { environmentId: string; paywallId: string; projectId: string },
  adapter: HostedPublishingAdapter
) {
  return queryOptions({
    queryKey: paywallKeys.activeDraft(input, adapter),
    queryFn: () => adapter.getActiveDraft(input),
  });
}

/** How long a gallery thumbnail may keep drawing an already-fetched document. */
const PREVIEW_DOCUMENT_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * The document behind one Paywall card's thumbnail.
 *
 * Cached far longer than the list itself: a published Version is immutable, and
 * a thumbnail that silently refetched on every hover or remount would turn a
 * gallery of twenty cards into twenty repeated document downloads.
 */
export function paywallPreviewDocumentQueryOptions(
  input: { environmentId: string; paywallId: string; projectId: string },
  adapter: HostedPublishingAdapter
) {
  return queryOptions({
    gcTime: PREVIEW_DOCUMENT_STALE_TIME_MS,
    queryKey: paywallKeys.previewDocument(input, adapter),
    queryFn: () => adapter.getPaywallPreviewDocument(input),
    // A thumbnail is decorative. Retrying a failed document read would spend
    // the list page's request budget on a picture rather than on the Paywall
    // data the page exists to show.
    retry: false,
    staleTime: PREVIEW_DOCUMENT_STALE_TIME_MS,
  });
}

export function hostedDraftQueryOptions(
  input: { draftId: string; paywallId: string; projectId: string },
  adapter: HostedPublishingAdapter
) {
  return queryOptions({
    queryKey: paywallKeys.draft(input, adapter),
    queryFn: () => adapter.getDraft(input),
  });
}
