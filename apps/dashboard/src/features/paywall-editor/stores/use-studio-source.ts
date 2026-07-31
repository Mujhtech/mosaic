import { createContext, useContext } from "react"

import {
  LOCAL_STUDIO_SOURCE,
  type StudioSource,
} from "@/features/paywall-editor/types/studio-source"

export const StudioSourceContext = createContext<StudioSource>(LOCAL_STUDIO_SOURCE)

export function useStudioSource() {
  return useContext(StudioSourceContext)
}
