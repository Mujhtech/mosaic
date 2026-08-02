import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AppErrorBoundary } from "@/components/feedback/app-error-boundary";
import { ConnectivityBanner } from "@/components/feedback/connectivity-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/providers/query-provider";

interface AppProvidersProps {
  children: ReactNode;
  queryClient: QueryClient;
}

export function AppProviders({ children, queryClient }: AppProvidersProps) {
  return (
    <AppErrorBoundary>
      <QueryProvider client={queryClient}>
        <TooltipProvider>
          <ConnectivityBanner />
          {children}
        </TooltipProvider>
      </QueryProvider>
    </AppErrorBoundary>
  );
}
