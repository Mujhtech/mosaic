import type {
  StudioCanvasAppearance,
  StudioCanvasDevice,
  StudioCanvasFitMode,
  StudioCanvasOrientation,
  StudioRecentInsertableType,
  StudioTool,
  StudioWorkspacePanel,
  StudioWorkspacePreferencesV1,
} from "@/features/paywall-editor/types/studio-workspace"

export const STUDIO_WORKSPACE_STORAGE_KEY = "mosaic:studio:workspace:v1"
export const STUDIO_WORKSPACE_SCHEMA_VERSION = 1

export const STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS = {
  left: { default: 300, min: 240, max: 440 },
  properties: { default: 360, min: 300, max: 560 },
  // UI integration must additionally enforce the live 45vh contract. The schema uses a safe
  // absolute ceiling because viewport dimensions are unavailable during SSR and storage parsing.
  diagnostics: { default: 220, min: 140, max: 1200 },
} as const satisfies Record<
  StudioWorkspacePanel,
  { readonly default: number; readonly min: number; readonly max: number }
>

export const STUDIO_CANVAS_ZOOM_BOUNDS = { min: 0.2, max: 2 } as const
export const STUDIO_CANVAS_TEXT_SCALE_BOUNDS = { min: 0.75, max: 1.5 } as const
export const STUDIO_DEFAULT_COUNTDOWN_PREVIEW_AT = "2026-01-01T12:00:00Z"
export const STUDIO_WORKSPACE_LOCALE_MAX_LENGTH = 7
export const STUDIO_COMPONENT_ID_MAX_LENGTH = 128
export const STUDIO_CANVAS_FRAME_POSITION_MAX_ENTRIES = 500
export const STUDIO_CANVAS_FRAME_POSITION_BOUNDS = { min: -100_000, max: 100_000 } as const
export const STUDIO_LAYER_LABEL_MAX_LENGTH = 80
export const STUDIO_LAYER_METADATA_MAX_ENTRIES = 500
export const STUDIO_RECENT_INSERTIONS_MAX = 5
export const STUDIO_WORKSPACE_MAX_CHARACTERS = 524_288

export const STUDIO_TOOLS = [
  "layers",
  "components",
  "templates",
  "designSystem",
  "products",
  "localization",
  "assets",
  "settings",
] as const satisfies readonly StudioTool[]

export const STUDIO_CANVAS_DEVICES = [
  "iphone-17-pro",
  "iphone-17-pro-max",
  "iphone-17",
  "ipad-pro-11",
  "ipad-pro-13",
  "pixel-10",
  "pixel-10-pro",
  "pixel-10-pro-xl",
  "galaxy-s26",
  "galaxy-s26-plus",
  "galaxy-s26-ultra",
] as const satisfies readonly StudioCanvasDevice[]
export const STUDIO_CANVAS_ORIENTATIONS = [
  "portrait",
  "landscape",
] as const satisfies readonly StudioCanvasOrientation[]
export const STUDIO_CANVAS_FIT_MODES = [
  "fit",
  "manual",
] as const satisfies readonly StudioCanvasFitMode[]
export const STUDIO_CANVAS_APPEARANCES = [
  "light",
  "dark",
] as const satisfies readonly StudioCanvasAppearance[]

export const STUDIO_RECENT_INSERTABLE_TYPES = [
  "stack",
  "carousel",
  "switch",
  "countdown",
  "text",
  "image",
  "icon",
  "featureList",
  "productSelector",
  "button",
] as const satisfies readonly StudioRecentInsertableType[]

const EMPTY_LABELS = Object.freeze({}) as Readonly<Record<string, string>>
const EMPTY_FRAME_POSITIONS = Object.freeze({}) as StudioWorkspacePreferencesV1["framePositions"]
const EMPTY_IDS = Object.freeze([]) as readonly string[]
const EMPTY_RECENT_INSERTIONS = Object.freeze([]) as readonly StudioRecentInsertableType[]

export const DEFAULT_STUDIO_WORKSPACE_PREFERENCES: StudioWorkspacePreferencesV1 = Object.freeze({
  schemaVersion: STUDIO_WORKSPACE_SCHEMA_VERSION,
  panels: Object.freeze({
    left: Object.freeze({
      size: STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS.left.default,
      collapsed: false,
    }),
    properties: Object.freeze({
      size: STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS.properties.default,
      collapsed: false,
    }),
    diagnostics: Object.freeze({
      size: STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS.diagnostics.default,
      collapsed: false,
    }),
  }),
  selectedTool: "layers",
  canvas: Object.freeze({
    device: "iphone-17-pro",
    orientation: "portrait",
    zoom: 1,
    fitMode: "fit",
    locale: "en",
    forceRTL: false,
    appearance: "light",
    textScale: 1,
    safeArea: true,
    countdownPreviewAt: STUDIO_DEFAULT_COUNTDOWN_PREVIEW_AT,
  }),
  framePositions: EMPTY_FRAME_POSITIONS,
  layerMetadata: Object.freeze({
    labels: EMPTY_LABELS,
    lockedIds: EMPTY_IDS,
    canvasHiddenIds: EMPTY_IDS,
  }),
  recentInsertions: EMPTY_RECENT_INSERTIONS,
})
