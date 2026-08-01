import { createContext, useContext } from "react";
import { generatedHostedPublishingAdapter } from "@/features/publishing/api/generated-hosted-publishing-adapter";
import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter";

export const HostedPublishingAdapterContext =
  createContext<HostedPublishingAdapter>(generatedHostedPublishingAdapter);

export function useHostedPublishingAdapter() {
  return useContext(HostedPublishingAdapterContext);
}
