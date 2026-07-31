import type { ReactNode } from "react"

import type { ExperimentAdapter } from "./experiment-adapter"
import { ExperimentAdapterContext } from "./use-experiment-adapter"

export function ExperimentAdapterProvider({
  adapter,
  children,
}: {
  adapter: ExperimentAdapter
  children: ReactNode
}) {
  return (
    <ExperimentAdapterContext.Provider value={adapter}>
      {children}
    </ExperimentAdapterContext.Provider>
  )
}
