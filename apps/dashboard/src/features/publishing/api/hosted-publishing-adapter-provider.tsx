import type { ReactNode } from "react";

import type { HostedPublishingAdapter } from "@/features/publishing/api/hosted-publishing-adapter";
import { HostedPublishingAdapterContext } from "@/features/publishing/api/use-hosted-publishing-adapter";

export function HostedPublishingAdapterProvider({
  adapter,
  children,
}: {
  adapter: HostedPublishingAdapter;
  children: ReactNode;
}) {
  return (
    <HostedPublishingAdapterContext.Provider value={adapter}>
      {children}
    </HostedPublishingAdapterContext.Provider>
  );
}
