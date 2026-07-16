import { QueryClientProvider, type QueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"

interface QueryProviderProps {
  children: ReactNode
  client: QueryClient
}

export function QueryProvider({ children, client }: QueryProviderProps) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
