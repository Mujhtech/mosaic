import {
  DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
  STUDIO_CANVAS_APPEARANCES,
  STUDIO_CANVAS_DEVICES,
  STUDIO_CANVAS_FIT_MODES,
  STUDIO_CANVAS_FRAME_POSITION_BOUNDS,
  STUDIO_CANVAS_FRAME_POSITION_MAX_ENTRIES,
  STUDIO_CANVAS_ORIENTATIONS,
  STUDIO_CANVAS_TEXT_SCALE_BOUNDS,
  STUDIO_CANVAS_ZOOM_BOUNDS,
  STUDIO_COMPONENT_ID_MAX_LENGTH,
  STUDIO_LAYER_LABEL_MAX_LENGTH,
  STUDIO_LAYER_METADATA_MAX_ENTRIES,
  STUDIO_RECENT_INSERTABLE_TYPES,
  STUDIO_RECENT_INSERTIONS_MAX,
  STUDIO_TOOLS,
  STUDIO_WORKSPACE_LOCALE_MAX_LENGTH,
  STUDIO_WORKSPACE_MAX_CHARACTERS,
  STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS,
  STUDIO_WORKSPACE_SCHEMA_VERSION,
  STUDIO_WORKSPACE_STORAGE_KEY,
  STUDIO_DEFAULT_COUNTDOWN_PREVIEW_AT,
} from "@/features/paywall-editor/constants/studio-workspace"
import type {
  StudioCanvasDevice,
  StudioCanvasFramePosition,
  StudioCanvasPreferences,
  StudioLayerMetadata,
  StudioRecentInsertableType,
  StudioWorkspacePanel,
  StudioWorkspacePanelPreference,
  StudioWorkspaceParseResult,
  StudioWorkspacePreferencesV1,
  StudioWorkspaceReadResult,
  StudioWorkspaceResetResult,
  StudioWorkspaceWriteResult,
} from "@/features/paywall-editor/types/studio-workspace"
import { isValidCountdownInstant } from "@/features/paywall-editor/utils/countdown"

export interface StudioWorkspaceStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const ROOT_KEYS = [
  "schemaVersion",
  "panels",
  "selectedTool",
  "canvas",
  "framePositions",
  "layerMetadata",
  "recentInsertions",
] as const
const LEGACY_ROOT_KEYS = ROOT_KEYS.filter((key) => key !== "framePositions")
const PANEL_KEYS = ["left", "properties", "diagnostics"] as const
const PANEL_PREFERENCE_KEYS = ["size", "collapsed"] as const
const CANVAS_KEYS = [
  "device",
  "orientation",
  "zoom",
  "fitMode",
  "locale",
  "forceRTL",
  "appearance",
  "textScale",
  "safeArea",
  "countdownPreviewAt",
] as const
const LEGACY_CANVAS_KEYS = CANVAS_KEYS.filter((key) => key !== "countdownPreviewAt")
const LAYER_METADATA_KEYS = ["labels", "lockedIds", "canvasHiddenIds"] as const

const TOOL_SET = new Set<string>(STUDIO_TOOLS)
const DEVICE_SET = new Set<string>(STUDIO_CANVAS_DEVICES)
const ORIENTATION_SET = new Set<string>(STUDIO_CANVAS_ORIENTATIONS)
const FIT_MODE_SET = new Set<string>(STUDIO_CANVAS_FIT_MODES)
const APPEARANCE_SET = new Set<string>(STUDIO_CANVAS_APPEARANCES)
const RECENT_TYPE_SET = new Set<string>(STUDIO_RECENT_INSERTABLE_TYPES)
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-(?:[A-Z]{2}|[0-9]{3}))?$/
const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/
const LEGACY_DEVICE_MIGRATIONS: Readonly<Record<string, StudioCanvasDevice>> = Object.freeze({
  iphone: "iphone-17-pro",
  android: "pixel-10-pro",
  tablet: "ipad-pro-11",
})

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]) {
  const actualKeys = Object.keys(record)
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key))
}

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
}

function isComponentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= STUDIO_COMPONENT_ID_MAX_LENGTH &&
    COMPONENT_ID_PATTERN.test(value)
  )
}

function isLayerLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= STUDIO_LAYER_LABEL_MAX_LENGTH
  )
}

function isLocale(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= STUDIO_WORKSPACE_LOCALE_MAX_LENGTH &&
    LOCALE_PATTERN.test(value)
  )
}

function isPanelPreference(
  value: unknown,
  panel: StudioWorkspacePanel,
): value is StudioWorkspacePanelPreference {
  if (!isRecord(value) || !hasExactKeys(value, PANEL_PREFERENCE_KEYS)) return false
  const bounds = STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS[panel]
  return isBoundedNumber(value.size, bounds.min, bounds.max) && typeof value.collapsed === "boolean"
}

function isCanvasPreferences(value: unknown): value is StudioCanvasPreferences {
  if (!isRecord(value) || !hasExactKeys(value, CANVAS_KEYS)) return false
  return (
    typeof value.device === "string" &&
    DEVICE_SET.has(value.device) &&
    typeof value.orientation === "string" &&
    ORIENTATION_SET.has(value.orientation) &&
    isBoundedNumber(value.zoom, STUDIO_CANVAS_ZOOM_BOUNDS.min, STUDIO_CANVAS_ZOOM_BOUNDS.max) &&
    typeof value.fitMode === "string" &&
    FIT_MODE_SET.has(value.fitMode) &&
    isLocale(value.locale) &&
    typeof value.forceRTL === "boolean" &&
    typeof value.appearance === "string" &&
    APPEARANCE_SET.has(value.appearance) &&
    isBoundedNumber(
      value.textScale,
      STUDIO_CANVAS_TEXT_SCALE_BOUNDS.min,
      STUDIO_CANVAS_TEXT_SCALE_BOUNDS.max,
    ) &&
    typeof value.safeArea === "boolean" &&
    isValidCountdownInstant(value.countdownPreviewAt)
  )
}

function isFramePosition(value: unknown): value is StudioCanvasFramePosition {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["x", "y"]) &&
    isBoundedNumber(
      value.x,
      STUDIO_CANVAS_FRAME_POSITION_BOUNDS.min,
      STUDIO_CANVAS_FRAME_POSITION_BOUNDS.max,
    ) &&
    isBoundedNumber(
      value.y,
      STUDIO_CANVAS_FRAME_POSITION_BOUNDS.min,
      STUDIO_CANVAS_FRAME_POSITION_BOUNDS.max,
    )
  )
}

function isFramePositions(
  value: unknown,
): value is Readonly<Record<string, StudioCanvasFramePosition>> {
  if (!isRecord(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length <= STUDIO_CANVAS_FRAME_POSITION_MAX_ENTRIES &&
    entries.every(([screenId, position]) => isComponentId(screenId) && isFramePosition(position))
  )
}

function isLabelMap(value: unknown): value is Readonly<Record<string, string>> {
  if (!isRecord(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length <= STUDIO_LAYER_METADATA_MAX_ENTRIES &&
    entries.every(([componentId, label]) => isComponentId(componentId) && isLayerLabel(label))
  )
}

function isUniqueComponentIdList(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > STUDIO_LAYER_METADATA_MAX_ENTRIES) return false
  return value.every(isComponentId) && new Set(value).size === value.length
}

function isLayerMetadata(value: unknown): value is StudioLayerMetadata {
  if (!isRecord(value) || !hasExactKeys(value, LAYER_METADATA_KEYS)) return false
  return (
    isLabelMap(value.labels) &&
    isUniqueComponentIdList(value.lockedIds) &&
    isUniqueComponentIdList(value.canvasHiddenIds)
  )
}

function isRecentInsertions(value: unknown): value is readonly StudioRecentInsertableType[] {
  if (!Array.isArray(value) || value.length > STUDIO_RECENT_INSERTIONS_MAX) return false
  return (
    value.every((entry) => typeof entry === "string" && RECENT_TYPE_SET.has(entry)) &&
    new Set(value).size === value.length
  )
}

function freezePreferences(preferences: StudioWorkspacePreferencesV1) {
  return Object.freeze({
    schemaVersion: STUDIO_WORKSPACE_SCHEMA_VERSION,
    panels: Object.freeze({
      left: Object.freeze({ ...preferences.panels.left }),
      properties: Object.freeze({ ...preferences.panels.properties }),
      diagnostics: Object.freeze({ ...preferences.panels.diagnostics }),
    }),
    selectedTool: preferences.selectedTool,
    canvas: Object.freeze({ ...preferences.canvas }),
    framePositions: Object.freeze(
      Object.fromEntries(
        Object.entries(preferences.framePositions).map(([screenId, position]) => [
          screenId,
          Object.freeze({ ...position }),
        ]),
      ),
    ),
    layerMetadata: Object.freeze({
      labels: Object.freeze({ ...preferences.layerMetadata.labels }),
      lockedIds: Object.freeze([...preferences.layerMetadata.lockedIds]),
      canvasHiddenIds: Object.freeze([...preferences.layerMetadata.canvasHiddenIds]),
    }),
    recentInsertions: Object.freeze([...preferences.recentInsertions]),
  }) satisfies StudioWorkspacePreferencesV1
}

function migrateLegacyCanvasDevice(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.canvas)) return value
  const device = value.canvas.device
  if (typeof device !== "string") return value
  const migratedDevice = LEGACY_DEVICE_MIGRATIONS[device]
  if (!migratedDevice) return value
  return { ...value, canvas: { ...value.canvas, device: migratedDevice } }
}

function migrateLegacyRecentInsertions(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.recentInsertions)) return value
  return {
    ...value,
    recentInsertions: value.recentInsertions.map((entry) =>
      entry === "verticalStack" ? "stack" : entry,
    ),
  }
}

function migrateLegacyCountdownPreviewAt(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.canvas)) return value
  if (!hasExactKeys(value.canvas, LEGACY_CANVAS_KEYS)) return value
  return {
    ...value,
    canvas: { ...value.canvas, countdownPreviewAt: STUDIO_DEFAULT_COUNTDOWN_PREVIEW_AT },
  }
}

function migrateLegacyFramePositions(value: unknown): unknown {
  if (!isRecord(value) || !hasExactKeys(value, LEGACY_ROOT_KEYS)) return value
  return { ...value, framePositions: {} }
}

function parsePreferences(input: unknown): StudioWorkspacePreferencesV1 | null {
  const value = migrateLegacyFramePositions(
    migrateLegacyCountdownPreviewAt(
      migrateLegacyRecentInsertions(migrateLegacyCanvasDevice(input)),
    ),
  )
  if (!isRecord(value) || !hasExactKeys(value, ROOT_KEYS)) return null
  if (value.schemaVersion !== STUDIO_WORKSPACE_SCHEMA_VERSION) return null
  if (!isRecord(value.panels) || !hasExactKeys(value.panels, PANEL_KEYS)) return null
  if (!isPanelPreference(value.panels.left, "left")) return null
  if (!isPanelPreference(value.panels.properties, "properties")) return null
  if (!isPanelPreference(value.panels.diagnostics, "diagnostics")) return null
  if (typeof value.selectedTool !== "string" || !TOOL_SET.has(value.selectedTool)) return null
  if (!isCanvasPreferences(value.canvas)) return null
  if (!isFramePositions(value.framePositions)) return null
  if (!isLayerMetadata(value.layerMetadata)) return null
  if (!isRecentInsertions(value.recentInsertions)) return null
  return freezePreferences(value as unknown as StudioWorkspacePreferencesV1)
}

export function parseStudioWorkspacePreferences(value: unknown): StudioWorkspaceParseResult {
  try {
    const preferences = parsePreferences(value)
    return preferences
      ? { status: "valid", preferences }
      : { status: "invalid", preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES }
  } catch {
    return { status: "invalid", preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES }
  }
}

function browserStorage(): StudioWorkspaceStorage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function browserViewportHeight() {
  if (typeof window === "undefined") return null
  const height = window.innerHeight
  return Number.isFinite(height) && height > 0 ? height : null
}

export function diagnosticsViewportMaximum(viewportHeight: number) {
  return viewportHeight * 0.45
}

function defaultReadResult(status: "missing" | "invalid"): StudioWorkspaceReadResult {
  return { status, source: "default", preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES }
}

export function readStudioWorkspacePreferences(
  storage: StudioWorkspaceStorage | null = browserStorage(),
  viewportHeight: number | null = browserViewportHeight(),
): StudioWorkspaceReadResult {
  if (!storage) return defaultReadResult("missing")
  try {
    const stored = storage.getItem(STUDIO_WORKSPACE_STORAGE_KEY)
    if (stored === null) return defaultReadResult("missing")
    if (stored.length > STUDIO_WORKSPACE_MAX_CHARACTERS) return defaultReadResult("invalid")
    const result = parseStudioWorkspacePreferences(JSON.parse(stored) as unknown)
    if (
      result.status === "valid" &&
      viewportHeight !== null &&
      result.preferences.panels.diagnostics.size > diagnosticsViewportMaximum(viewportHeight)
    ) {
      return defaultReadResult("invalid")
    }
    return result.status === "valid"
      ? { status: "valid", source: "persisted", preferences: result.preferences }
      : defaultReadResult("invalid")
  } catch {
    return defaultReadResult("invalid")
  }
}

export function writeStudioWorkspacePreferences(
  value: unknown,
  storage: StudioWorkspaceStorage | null = browserStorage(),
): StudioWorkspaceWriteResult {
  if (!storage) return { status: "unavailable" }
  try {
    const result = parseStudioWorkspacePreferences(value)
    if (result.status === "invalid") return { status: "invalid" }
    const serialized = JSON.stringify(result.preferences)
    if (serialized.length > STUDIO_WORKSPACE_MAX_CHARACTERS) return { status: "invalid" }
    storage.setItem(STUDIO_WORKSPACE_STORAGE_KEY, serialized)
    return { status: "written" }
  } catch {
    return { status: "failed" }
  }
}

export function resetStudioWorkspacePreferences(
  storage: StudioWorkspaceStorage | null = browserStorage(),
): StudioWorkspaceResetResult {
  if (!storage) return { status: "unavailable" }
  try {
    storage.removeItem(STUDIO_WORKSPACE_STORAGE_KEY)
    return { status: "reset" }
  } catch {
    return { status: "failed" }
  }
}
