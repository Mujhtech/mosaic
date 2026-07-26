import type { ReactNode } from "react"

import type { PlacementDecisionsAdapter } from "@/features/placement-decisions/api/placement-decisions-adapter"
import { PlacementDecisionsAdapterContext } from "@/features/placement-decisions/api/use-placement-decisions-adapter"

export function PlacementDecisionsAdapterProvider({
  adapter,
  children,
}: {
  adapter: PlacementDecisionsAdapter
  children: ReactNode
}) {
  return (
    <PlacementDecisionsAdapterContext.Provider value={adapter}>
      {children}
    </PlacementDecisionsAdapterContext.Provider>
  )
}
