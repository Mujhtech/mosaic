import type { QueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { TooltipProvider } from "@/components/ui/tooltip"
import { QueryProvider } from "@/providers/query-provider"

interface AppProvidersProps {
  children: ReactNode
  queryClient: QueryClient
}

export function AppProviders({ children, queryClient }: AppProvidersProps) {
  return (
    <QueryProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryProvider>
  )
}
