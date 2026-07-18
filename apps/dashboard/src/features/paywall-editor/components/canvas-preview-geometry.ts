import { STUDIO_CANVAS_ZOOM_BOUNDS } from "@/features/paywall-editor/constants/studio-workspace"
import { getCanvasDevicePreset } from "@/features/paywall-editor/constants/canvas-devices"
import type {
  StudioCanvasDevice,
  StudioCanvasOrientation,
  StudioCanvasPreferences,
} from "@/features/paywall-editor/types/studio-workspace"

export interface CanvasDeviceGeometry {
  readonly height: number
  readonly safeArea: {
    readonly top: number
    readonly right: number
    readonly bottom: number
    readonly left: number
  }
  readonly width: number
}

export interface CanvasDeviceNodeGeometry {
  readonly height: number
  readonly shellHeight: number
  readonly shellWidth: number
  readonly width: number
}

export const CANVAS_DEVICE_LABEL_HEIGHT = 38

export function resolveCanvasDeviceGeometry(
  device: StudioCanvasDevice,
  orientation: StudioCanvasOrientation,
): CanvasDeviceGeometry {
  const portrait = getCanvasDevicePreset(device).portrait
  if (orientation === "portrait") return portrait
  return {
    width: portrait.height,
    height: portrait.width,
    safeArea: {
      top: portrait.safeArea.left,
      right: portrait.safeArea.top,
      bottom: portrait.safeArea.right,
      left: portrait.safeArea.bottom,
    },
  }
}

export function resolveCanvasDeviceNodeGeometry(
  device: StudioCanvasDevice,
  orientation: StudioCanvasOrientation,
): CanvasDeviceNodeGeometry {
  const preset = getCanvasDevicePreset(device)
  const screen = resolveCanvasDeviceGeometry(device, orientation)
  const shellWidth = screen.width + preset.frame.bezel * 2
  const shellHeight = screen.height + preset.frame.bezel * 2
  return {
    width: shellWidth,
    height: shellHeight + CANVAS_DEVICE_LABEL_HEIGHT,
    shellHeight,
    shellWidth,
  }
}

export function calculateCanvasScale({
  availableHeight,
  availableWidth,
  geometry,
  preferences,
}: {
  availableHeight: number
  availableWidth: number
  geometry: Pick<CanvasDeviceGeometry, "height" | "width">
  preferences: Pick<StudioCanvasPreferences, "fitMode" | "zoom">
}) {
  if (preferences.fitMode === "manual") return preferences.zoom
  if (availableWidth <= 0 || availableHeight <= 0) return 1
  const fitted = Math.min(
    (availableWidth - 48) / geometry.width,
    (availableHeight - 48) / geometry.height,
    STUDIO_CANVAS_ZOOM_BOUNDS.max,
  )
  return Math.max(STUDIO_CANVAS_ZOOM_BOUNDS.min, fitted)
}
