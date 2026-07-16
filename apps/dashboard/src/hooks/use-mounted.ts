import { useSyncExternalStore } from "react"

const subscribe = () => () => undefined

/**
 * Reports hydration without introducing an effect-driven render pass.
 * Keep feature-owned hooks out of this global directory.
 */
export function useMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
}
