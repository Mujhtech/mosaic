import { useSyncExternalStore } from "react"

export type StudioViewportMode = "large" | "medium" | "compact" | "desktop-required"

const STUDIO_LARGE_VIEWPORT_MIN_WIDTH = 1440
const STUDIO_MEDIUM_VIEWPORT_MIN_WIDTH = 1120
const STUDIO_COMPACT_VIEWPORT_MIN_WIDTH = 768
const STUDIO_SERVER_VIEWPORT_MODE: StudioViewportMode = "large"

type ViewportListener = () => void

const viewportListeners = new Set<ViewportListener>()

function emitViewportChange() {
  for (const listener of viewportListeners) {
    listener()
  }
}

function subscribeToStudioViewport(listener: ViewportListener) {
  viewportListeners.add(listener)

  if (viewportListeners.size === 1) {
    window.addEventListener("resize", emitViewportChange)
  }

  return () => {
    viewportListeners.delete(listener)

    if (viewportListeners.size === 0) {
      window.removeEventListener("resize", emitViewportChange)
    }
  }
}

export function classifyStudioViewport(width: number): StudioViewportMode {
  if (!Number.isFinite(width) || width < 0) {
    return "desktop-required"
  }

  if (width >= STUDIO_LARGE_VIEWPORT_MIN_WIDTH) {
    return "large"
  }

  if (width >= STUDIO_MEDIUM_VIEWPORT_MIN_WIDTH) {
    return "medium"
  }

  if (width >= STUDIO_COMPACT_VIEWPORT_MIN_WIDTH) {
    return "compact"
  }

  return "desktop-required"
}

function getStudioViewportSnapshot() {
  return classifyStudioViewport(window.innerWidth)
}

function getStudioViewportServerSnapshot() {
  return STUDIO_SERVER_VIEWPORT_MODE
}

export function useStudioViewportMode() {
  return useSyncExternalStore(
    subscribeToStudioViewport,
    getStudioViewportSnapshot,
    getStudioViewportServerSnapshot,
  )
}
