import type { ReactNode } from "react";

import { StudioSourceContext } from "@/features/paywall-editor/stores/use-studio-source";
import type { StudioSource } from "@/features/paywall-editor/types/studio-source";

export function StudioSourceProvider({
  children,
  source,
}: {
  children: ReactNode;
  source: StudioSource;
}) {
  return (
    <StudioSourceContext.Provider value={source}>
      {children}
    </StudioSourceContext.Provider>
  );
}
