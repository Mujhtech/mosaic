import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
  STUDIO_CANVAS_APPEARANCES,
  STUDIO_CANVAS_DEVICES,
  STUDIO_CANVAS_FIT_MODES,
  STUDIO_CANVAS_FRAME_POSITION_BOUNDS,
  STUDIO_CANVAS_FRAME_POSITION_MAX_ENTRIES,
  STUDIO_CANVAS_ORIENTATIONS,
  STUDIO_COMPONENT_ID_MAX_LENGTH,
  STUDIO_LAYER_LABEL_MAX_LENGTH,
  STUDIO_LAYER_METADATA_MAX_ENTRIES,
  STUDIO_RECENT_INSERTABLE_TYPES,
  STUDIO_RECENT_INSERTIONS_MAX,
  STUDIO_TOOLS,
  STUDIO_WORKSPACE_MAX_CHARACTERS,
  STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS,
  STUDIO_WORKSPACE_STORAGE_KEY,
} from "@/features/paywall-editor/constants/studio-workspace"
import {
  diagnosticsViewportMaximum,
  parseStudioWorkspacePreferences,
  readStudioWorkspacePreferences,
  resetStudioWorkspacePreferences,
  writeStudioWorkspacePreferences,
  type StudioWorkspaceStorage,
} from "@/features/paywall-editor/mutations/studio-workspace-persistence"
import type { StudioWorkspacePanel } from "@/features/paywall-editor/types/studio-workspace"

interface MutableStudioWorkspacePreferences {
  schemaVersion: number
  panels: Record<StudioWorkspacePanel, { size: number; collapsed: boolean }>
  selectedTool: string
  canvas: {
    device: string
    orientation: string
    zoom: number
    fitMode: string
    locale: string
    forceRTL: boolean
    appearance: string
    textScale: number
    safeArea: boolean
    countdownPreviewAt: string
  }
  framePositions: Record<string, { x: number; y: number }>
  layerMetadata: {
    labels: Record<string, string>
    lockedIds: string[]
    canvasHiddenIds: string[]
  }
  recentInsertions: string[]
}

function mutableDefaults(): MutableStudioWorkspacePreferences {
  return JSON.parse(
    JSON.stringify(DEFAULT_STUDIO_WORKSPACE_PREFERENCES),
  ) as MutableStudioWorkspacePreferences
}

function createMemoryStorage(initial: string | null = null) {
  let value = initial
  const storage: StudioWorkspaceStorage = {
    getItem: vi.fn((key) => (key === STUDIO_WORKSPACE_STORAGE_KEY ? value : null)),
    setItem: vi.fn((key, nextValue) => {
      if (key === STUDIO_WORKSPACE_STORAGE_KEY) value = nextValue
    }),
    removeItem: vi.fn((key) => {
      if (key === STUDIO_WORKSPACE_STORAGE_KEY) value = null
    }),
  }
  return { storage, read: () => value }
}

function readValue(value: MutableStudioWorkspacePreferences) {
  return readStudioWorkspacePreferences(createMemoryStorage(JSON.stringify(value)).storage)
}

function expectInvalid(value: MutableStudioWorkspacePreferences) {
  expect(readValue(value)).toEqual({
    status: "invalid",
    source: "default",
    preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
  })
}

describe("Studio workspace preference persistence", () => {
  it("provides complete deeply frozen defaults for missing or unavailable storage", () => {
    const expectedDefaults = {
      schemaVersion: 1,
      panels: {
        left: { size: 300, collapsed: false },
        properties: { size: 360, collapsed: false },
        diagnostics: { size: 220, collapsed: false },
      },
      selectedTool: "layers",
      canvas: {
        device: "iphone-17-pro",
        orientation: "portrait",
        zoom: 1,
        fitMode: "fit",
        locale: "en",
        forceRTL: false,
        appearance: "light",
        textScale: 1,
        safeArea: true,
        countdownPreviewAt: "2026-01-01T12:00:00Z",
      },
      framePositions: {},
      layerMetadata: { labels: {}, lockedIds: [], canvasHiddenIds: [] },
      recentInsertions: [],
    }

    expect(readStudioWorkspacePreferences(createMemoryStorage().storage)).toEqual({
      status: "missing",
      source: "default",
      preferences: expectedDefaults,
    })
    expect(readStudioWorkspacePreferences(null)).toEqual({
      status: "missing",
      source: "default",
      preferences: expectedDefaults,
    })
    expect(DEFAULT_STUDIO_WORKSPACE_PREFERENCES).toEqual(expectedDefaults)
    expect(Object.isFrozen(DEFAULT_STUDIO_WORKSPACE_PREFERENCES)).toBe(true)
    expect(Object.isFrozen(DEFAULT_STUDIO_WORKSPACE_PREFERENCES.panels)).toBe(true)
    expect(Object.isFrozen(DEFAULT_STUDIO_WORKSPACE_PREFERENCES.canvas)).toBe(true)
    expect(Object.isFrozen(DEFAULT_STUDIO_WORKSPACE_PREFERENCES.framePositions)).toBe(true)
    expect(Object.isFrozen(DEFAULT_STUDIO_WORKSPACE_PREFERENCES.layerMetadata.labels)).toBe(true)
    expect(Object.isFrozen(DEFAULT_STUDIO_WORKSPACE_PREFERENCES.recentInsertions)).toBe(true)
    expect(STUDIO_WORKSPACE_STORAGE_KEY).toBe("mosaic:studio:workspace:v1")
    expect(STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS.diagnostics.max).toBe(1200)
    expect(STUDIO_TOOLS).toEqual([
      "layers",
      "components",
      "templates",
      "designSystem",
      "products",
      "localization",
      "assets",
      "settings",
    ])
    expect(STUDIO_CANVAS_DEVICES).toEqual([
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
    ])
    expect(STUDIO_CANVAS_ORIENTATIONS).toEqual(["portrait", "landscape"])
    expect(STUDIO_CANVAS_FIT_MODES).toEqual(["fit", "manual"])
    expect(STUDIO_CANVAS_APPEARANCES).toEqual(["light", "dark"])
    expect(STUDIO_RECENT_INSERTABLE_TYPES).toEqual([
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
    ])
  })

  it("round-trips a complete valid value with persisted-source metadata", () => {
    const value = mutableDefaults()
    value.panels.left = { size: 420, collapsed: true }
    value.panels.properties = { size: 520, collapsed: true }
    value.panels.diagnostics = { size: 900, collapsed: true }
    value.selectedTool = "assets"
    value.canvas = {
      device: "pixel-10-pro",
      orientation: "landscape",
      zoom: 1.75,
      fitMode: "manual",
      locale: "ar",
      forceRTL: true,
      appearance: "dark",
      textScale: 1.25,
      safeArea: false,
      countdownPreviewAt: "2028-06-01T10:30:00Z",
    }
    value.framePositions = {
      main: { x: -120.25, y: 48.5 },
      "upgrade-sheet": { x: 680, y: 48.5 },
    }
    value.layerMetadata = {
      labels: { headline: "Primary headline", "hero-image": "Hero image" },
      lockedIds: ["headline"],
      canvasHiddenIds: ["hero-image"],
    }
    value.recentInsertions = ["stack", "text", "image", "button"]

    const memory = createMemoryStorage()
    expect(writeStudioWorkspacePreferences(value, memory.storage)).toEqual({ status: "written" })
    expect(memory.storage.setItem).toHaveBeenCalledWith(
      STUDIO_WORKSPACE_STORAGE_KEY,
      expect.any(String),
    )

    const result = readStudioWorkspacePreferences(memory.storage, null)
    expect(result.status).toBe("valid")
    expect(result.source).toBe("persisted")
    expect(result.preferences).toEqual(value)
    expect(Object.isFrozen(result.preferences.framePositions.main)).toBe(true)
    expect(Object.isFrozen(result.preferences.layerMetadata.lockedIds)).toBe(true)
  })

  it.each([
    ["iphone", "iphone-17-pro"],
    ["android", "pixel-10-pro"],
    ["tablet", "ipad-pro-11"],
  ])("migrates the legacy %s device without discarding workspace state", (legacy, current) => {
    const value = mutableDefaults()
    value.canvas.device = legacy
    value.panels.left = { size: 420, collapsed: true }
    value.selectedTool = "assets"

    const result = readValue(value)

    expect(result).toMatchObject({
      status: "valid",
      source: "persisted",
      preferences: {
        canvas: { device: current },
        panels: { left: { size: 420, collapsed: true } },
        selectedTool: "assets",
      },
    })
  })

  it("adds the frozen Countdown preview instant to legacy workspace canvas preferences", () => {
    const value = mutableDefaults()
    Reflect.deleteProperty(value.canvas, "countdownPreviewAt")
    value.selectedTool = "components"

    expect(readValue(value)).toMatchObject({
      status: "valid",
      source: "persisted",
      preferences: {
        selectedTool: "components",
        canvas: { countdownPreviewAt: "2026-01-01T12:00:00Z" },
      },
    })
  })

  it("migrates legacy workspace preferences without frame positions to safe empty positions", () => {
    const value = mutableDefaults()
    Reflect.deleteProperty(value, "framePositions")
    value.selectedTool = "components"

    expect(readValue(value)).toMatchObject({
      status: "valid",
      source: "persisted",
      preferences: {
        selectedTool: "components",
        framePositions: {},
      },
    })
  })

  it("restores every default when diagnostics exceeds the current 45vh maximum", () => {
    const value = mutableDefaults()
    value.panels.left = { size: 420, collapsed: true }
    value.panels.properties = { size: 520, collapsed: true }
    value.panels.diagnostics = { size: 361, collapsed: true }
    value.selectedTool = "settings"
    value.canvas.device = "galaxy-s26-ultra"

    expect(diagnosticsViewportMaximum(800)).toBe(360)
    expect(
      readStudioWorkspacePreferences(createMemoryStorage(JSON.stringify(value)).storage, 800),
    ).toEqual({
      status: "invalid",
      source: "default",
      preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
    })

    value.panels.diagnostics.size = 360
    expect(
      readStudioWorkspacePreferences(createMemoryStorage(JSON.stringify(value)).storage, 800),
    ).toMatchObject({ status: "valid", source: "persisted", preferences: value })
  })

  it("restores complete defaults for malformed, incomplete, unknown, and incompatible data", () => {
    expect(readStudioWorkspacePreferences(createMemoryStorage("{").storage).status).toBe("invalid")

    const incomplete = mutableDefaults()
    Reflect.deleteProperty(incomplete.canvas, "locale")
    expectInvalid(incomplete)

    const unknownRoot = mutableDefaults()
    Object.assign(unknownRoot, { futureField: true })
    expectInvalid(unknownRoot)

    const unknownNested = mutableDefaults()
    Object.assign(unknownNested.canvas, { futureField: true })
    expectInvalid(unknownNested)

    const wrongVersion = mutableDefaults()
    wrongVersion.schemaVersion = 2
    expectInvalid(wrongVersion)

    const wrongShape = mutableDefaults()
    Object.assign(wrongShape, { panels: [] })
    expectInvalid(wrongShape)
  })

  it.each([
    ["left minimum", (value: MutableStudioWorkspacePreferences) => (value.panels.left.size = 239)],
    ["left maximum", (value: MutableStudioWorkspacePreferences) => (value.panels.left.size = 441)],
    [
      "properties minimum",
      (value: MutableStudioWorkspacePreferences) => (value.panels.properties.size = 299),
    ],
    [
      "properties maximum",
      (value: MutableStudioWorkspacePreferences) => (value.panels.properties.size = 561),
    ],
    [
      "diagnostics minimum",
      (value: MutableStudioWorkspacePreferences) => (value.panels.diagnostics.size = 139),
    ],
    [
      "diagnostics absolute maximum",
      (value: MutableStudioWorkspacePreferences) =>
        (value.panels.diagnostics.size = STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS.diagnostics.max + 1),
    ],
    ["zoom minimum", (value: MutableStudioWorkspacePreferences) => (value.canvas.zoom = 0.19)],
    ["zoom maximum", (value: MutableStudioWorkspacePreferences) => (value.canvas.zoom = 2.01)],
    [
      "text-scale minimum",
      (value: MutableStudioWorkspacePreferences) => (value.canvas.textScale = 0.74),
    ],
    [
      "text-scale maximum",
      (value: MutableStudioWorkspacePreferences) => (value.canvas.textScale = 1.51),
    ],
    [
      "non-finite panel size",
      (value: MutableStudioWorkspacePreferences) => (value.panels.left.size = Number.NaN),
    ],
    [
      "non-finite zoom",
      (value: MutableStudioWorkspacePreferences) => (value.canvas.zoom = Infinity),
    ],
    [
      "frame x minimum",
      (value: MutableStudioWorkspacePreferences) =>
        (value.framePositions.main = {
          x: STUDIO_CANVAS_FRAME_POSITION_BOUNDS.min - 1,
          y: 0,
        }),
    ],
    [
      "non-finite frame y",
      (value: MutableStudioWorkspacePreferences) =>
        (value.framePositions.main = { x: 0, y: Number.NaN }),
    ],
  ])("rejects an out-of-range %s without clamping", (_name, invalidate) => {
    const value = mutableDefaults()
    invalidate(value)
    expect(parseStudioWorkspacePreferences(value)).toEqual({
      status: "invalid",
      preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
    })
  })

  it("rejects a non-finite JSON number and accepts every numeric boundary", () => {
    const raw = JSON.stringify(mutableDefaults()).replace('"zoom":1', '"zoom":1e309')
    expect(readStudioWorkspacePreferences(createMemoryStorage(raw).storage).status).toBe("invalid")

    const boundaries = mutableDefaults()
    boundaries.panels.left.size = STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS.left.min
    boundaries.panels.properties.size = STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS.properties.max
    boundaries.panels.diagnostics.size = STUDIO_WORKSPACE_PANEL_SIZE_BOUNDS.diagnostics.max
    boundaries.canvas.zoom = 0.2
    boundaries.canvas.textScale = 1.5
    expect(parseStudioWorkspacePreferences(boundaries).status).toBe("valid")
  })

  it.each([
    ["tool", (value: MutableStudioWorkspacePreferences) => (value.selectedTool = "future-tool")],
    ["device", (value: MutableStudioWorkspacePreferences) => (value.canvas.device = "desktop")],
    [
      "orientation",
      (value: MutableStudioWorkspacePreferences) => (value.canvas.orientation = "square"),
    ],
    ["fit mode", (value: MutableStudioWorkspacePreferences) => (value.canvas.fitMode = "fill")],
    [
      "appearance",
      (value: MutableStudioWorkspacePreferences) => (value.canvas.appearance = "system"),
    ],
  ])("rejects an unknown %s enum", (_name, invalidate) => {
    const value = mutableDefaults()
    invalidate(value)
    expectInvalid(value)
  })

  it("rejects wrong scalar types and invalid locale identifiers", () => {
    const collapsed = mutableDefaults()
    Object.assign(collapsed.panels.left, { collapsed: "false" })
    expectInvalid(collapsed)

    const forceRTL = mutableDefaults()
    Object.assign(forceRTL.canvas, { forceRTL: 1 })
    expectInvalid(forceRTL)

    const safeArea = mutableDefaults()
    Object.assign(safeArea.canvas, { safeArea: null })
    expectInvalid(safeArea)

    for (const locale of ["", "EN-us", "english-US", "en_US"]) {
      const value = mutableDefaults()
      value.canvas.locale = locale
      expectInvalid(value)
    }

    for (const countdownPreviewAt of [
      "",
      "2028-02-31T10:30:00Z",
      "2028-06-01T10:30:00.000Z",
      "2028-06-01T10:30:00+00:00",
    ]) {
      const value = mutableDefaults()
      value.canvas.countdownPreviewAt = countdownPreviewAt
      expectInvalid(value)
    }
  })

  it("rejects invalid, duplicate, and overlong layer metadata", () => {
    const overlongLabel = mutableDefaults()
    overlongLabel.layerMetadata.labels.hero = "x".repeat(STUDIO_LAYER_LABEL_MAX_LENGTH + 1)
    expectInvalid(overlongLabel)

    const blankLabel = mutableDefaults()
    blankLabel.layerMetadata.labels.hero = "   "
    expectInvalid(blankLabel)

    const overlongId = mutableDefaults()
    overlongId.layerMetadata.labels["a".repeat(STUDIO_COMPONENT_ID_MAX_LENGTH + 1)] = "Label"
    expectInvalid(overlongId)

    const duplicateLocked = mutableDefaults()
    duplicateLocked.layerMetadata.lockedIds = ["hero", "hero"]
    expectInvalid(duplicateLocked)

    const duplicateHidden = mutableDefaults()
    duplicateHidden.layerMetadata.canvasHiddenIds = ["hero", "hero"]
    expectInvalid(duplicateHidden)

    const tooManyLabels = mutableDefaults()
    tooManyLabels.layerMetadata.labels = Object.fromEntries(
      Array.from({ length: STUDIO_LAYER_METADATA_MAX_ENTRIES + 1 }, (_, index) => [
        "component-" + index,
        "Label " + index,
      ]),
    )
    expectInvalid(tooManyLabels)

    const tooManyIds = mutableDefaults()
    tooManyIds.layerMetadata.lockedIds = Array.from(
      { length: STUDIO_LAYER_METADATA_MAX_ENTRIES + 1 },
      (_, index) => "component-" + index,
    )
    expectInvalid(tooManyIds)
  })

  it("rejects malformed, unknown, and unbounded frame positions", () => {
    const malformed = mutableDefaults()
    malformed.framePositions.main = { x: 20, y: 40 }
    Object.assign(malformed.framePositions.main, { z: 60 })
    expectInvalid(malformed)

    const badId = mutableDefaults()
    badId.framePositions["Bad screen ID"] = { x: 0, y: 0 }
    expectInvalid(badId)

    const tooMany = mutableDefaults()
    tooMany.framePositions = Object.fromEntries(
      Array.from({ length: STUDIO_CANVAS_FRAME_POSITION_MAX_ENTRIES + 1 }, (_, index) => [
        `screen-${index}`,
        { x: index, y: 0 },
      ]),
    )
    expectInvalid(tooMany)
  })

  it("rejects duplicate, overlong, or unsupported recent insertion values", () => {
    const duplicate = mutableDefaults()
    duplicate.recentInsertions = ["text", "text"]
    expectInvalid(duplicate)

    const overlong = mutableDefaults()
    overlong.recentInsertions = STUDIO_RECENT_INSERTABLE_TYPES.slice(
      0,
      STUDIO_RECENT_INSERTIONS_MAX + 1,
    )
    expectInvalid(overlong)

    const unsupported = mutableDefaults()
    unsupported.recentInsertions = ["scrollContainer"]
    expectInvalid(unsupported)
  })

  it("rejects an oversized serialized value before parsing", () => {
    const storage = createMemoryStorage(" ".repeat(STUDIO_WORKSPACE_MAX_CHARACTERS + 1)).storage
    expect(readStudioWorkspacePreferences(storage).status).toBe("invalid")
  })

  it("returns nonthrowing metadata when get, set, or remove operations fail", () => {
    const getFailure: StudioWorkspaceStorage = {
      getItem: vi.fn(() => {
        throw new DOMException("Storage disabled", "SecurityError")
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    expect(readStudioWorkspacePreferences(getFailure)).toEqual({
      status: "invalid",
      source: "default",
      preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
    })

    const setFailure: StudioWorkspaceStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError")
      }),
      removeItem: vi.fn(),
    }
    expect(
      writeStudioWorkspacePreferences(DEFAULT_STUDIO_WORKSPACE_PREFERENCES, setFailure),
    ).toEqual({ status: "failed" })

    const removeFailure: StudioWorkspaceStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new DOMException("Storage disabled", "SecurityError")
      }),
    }
    expect(resetStudioWorkspacePreferences(removeFailure)).toEqual({ status: "failed" })
    expect(writeStudioWorkspacePreferences(DEFAULT_STUDIO_WORKSPACE_PREFERENCES, null)).toEqual({
      status: "unavailable",
    })
    expect(resetStudioWorkspacePreferences(null)).toEqual({ status: "unavailable" })
  })

  it("rejects invalid writes and resets a persisted workspace to missing defaults", () => {
    const memory = createMemoryStorage()
    expect(writeStudioWorkspacePreferences({ schemaVersion: 1 }, memory.storage)).toEqual({
      status: "invalid",
    })
    expect(memory.storage.setItem).not.toHaveBeenCalled()

    expect(
      writeStudioWorkspacePreferences(DEFAULT_STUDIO_WORKSPACE_PREFERENCES, memory.storage),
    ).toEqual({ status: "written" })
    expect(resetStudioWorkspacePreferences(memory.storage)).toEqual({ status: "reset" })
    expect(memory.storage.removeItem).toHaveBeenCalledWith(STUDIO_WORKSPACE_STORAGE_KEY)
    expect(memory.read()).toBeNull()
    expect(readStudioWorkspacePreferences(memory.storage).status).toBe("missing")
  })

  it("deep-copies valid input and prevents callers from mutating canonical defaults", () => {
    const input = mutableDefaults()
    const result = parseStudioWorkspacePreferences(input)
    if (result.status !== "valid") throw new Error("Expected valid Studio workspace preferences")
    const parsed = result.preferences

    input.panels.left.size = 400
    input.framePositions.main = { x: 20, y: 30 }
    input.layerMetadata.labels.hero = "Changed later"
    expect(parsed.panels.left.size).toBe(300)
    expect(parsed.framePositions).toEqual({})
    expect(parsed.layerMetadata.labels).toEqual({})
    expect(Reflect.set(parsed.canvas, "zoom", 2)).toBe(false)
    expect(Reflect.set(DEFAULT_STUDIO_WORKSPACE_PREFERENCES.panels.left, "size", 400)).toBe(false)
    expect(DEFAULT_STUDIO_WORKSPACE_PREFERENCES.panels.left.size).toBe(300)
  })
})
