import { queryOptions } from "@tanstack/react-query";

import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter";

export const publishingKeys = {
  all: ["publishing"] as const,
  validation: (
    input: {
      draftId: string;
      environmentId: string;
      expectedRevision: number;
      paywallId: string;
      projectId: string;
    },
    adapter: HostedPublishingAdapter
  ) => [...publishingKeys.all, "validation", input, adapter] as const,
};

export function publishValidationQueryOptions(
  input: {
    draftId: string;
    environmentId: string;
    expectedRevision: number;
    paywallId: string;
    projectId: string;
  },
  adapter: HostedPublishingAdapter
) {
  return queryOptions({
    queryKey: publishingKeys.validation(input, adapter),
    queryFn: () => adapter.validateDraftForPublish(input),
    refetchOnMount: "always",
  });
}
