import {
  CONTRACT_PENDING_HOSTED_PUBLISHING_ADAPTER,
  type HostedPublishingAdapter,
} from "@/features/publishing/api/hosted-publishing-adapter";

export function createTestHostedPublishingAdapter(
  overrides: Partial<HostedPublishingAdapter> = {}
): HostedPublishingAdapter {
  return {
    ...CONTRACT_PENDING_HOSTED_PUBLISHING_ADAPTER,
    status: "available",
    ...overrides,
  };
}
