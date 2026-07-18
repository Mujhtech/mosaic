import { describe, expect, it, vi } from "vitest"

import canonicalFixture from "../../../../../../protocol/fixtures/v0.2/complete-paywall.json"

import {
  DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
  STUDIO_RECENT_INSERTABLE_TYPES,
  STUDIO_WORKSPACE_STORAGE_KEY,
} from "@/features/paywall-editor/constants/studio-workspace"
import { serializeDocument } from "@/features/paywall-editor/mutations/local-project-file"
import type { StudioWorkspaceStorage } from "@/features/paywall-editor/mutations/studio-workspace-persistence"
import { createEditorStore } from "@/features/paywall-editor/stores/editor-store"
import {
  createStudioWorkspaceStore,
  type StudioWorkspaceStore,
} from "@/features/paywall-editor/stores/studio-workspace-store"
import type { MosaicDocument } from "@/features/paywall-editor/types/editor"
import type {
  StudioCanvasPreferences,
  StudioRecentInsertableType,
  StudioWorkspacePreferencesV1,
} from "@/features/paywall-editor/types/studio-workspace"

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

function persistedPreferences(): StudioWorkspacePreferencesV1 {
  return {
    ...DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
    selectedTool: "assets",
    panels: {
      ...DEFAULT_STUDIO_WORKSPACE_PREFERENCES.panels,
      left: { size: 400, collapsed: true },
    },
    canvas: {
      ...DEFAULT_STUDIO_WORKSPACE_PREFERENCES.canvas,
      locale: "ar",
      forceRTL: true,
      appearance: "dark",
    },
  }
}

function expectOneWrite(
  store: StudioWorkspaceStore,
  storage: StudioWorkspaceStorage,
  action: () => boolean,
) {
  const setItem = vi.mocked(storage.setItem)
  const callsBefore = setItem.mock.calls.length
  expect(action()).toBe(true)
  expect(setItem).toHaveBeenCalledTimes(callsBefore + 1)
  expect(store.getSnapshot().latestPersistence).toEqual({
    operation: "write",
    status: "written",
  })
}

function expectNoWrite(storage: StudioWorkspaceStorage, action: () => boolean) {
  const setItem = vi.mocked(storage.setItem)
  const callsBefore = setItem.mock.calls.length
  expect(action()).toBe(false)
  expect(setItem).toHaveBeenCalledTimes(callsBefore)
}

function collectObjectKeys(value: unknown, keys = new Set<string>()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectObjectKeys(entry, keys))
    return keys
  }
  if (!value || typeof value !== "object") return keys
  Object.entries(value).forEach(([key, entry]) => {
    keys.add(key)
    collectObjectKeys(entry, keys)
  })
  return keys
}

describe("Studio workspace store", () => {
  it("reads valid persisted preferences exactly once and preserves initial metadata", () => {
    const persisted = persistedPreferences()
    const memory = createMemoryStorage(JSON.stringify(persisted))
    const store = createStudioWorkspaceStore({ storage: memory.storage })

    expect(memory.storage.getItem).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({
      preferences: persisted,
      initialReadStatus: "valid",
      initialSource: "persisted",
      latestPersistence: { operation: "idle", status: "idle" },
    })

    expect(store.setSelectedTool("settings")).toBe(true)
    expect(memory.storage.getItem).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().initialReadStatus).toBe("valid")
    expect(store.getSnapshot().initialSource).toBe("persisted")

    store.resetWorkspace()
    expect(store.getSnapshot().initialReadStatus).toBe("valid")
    expect(store.getSnapshot().initialSource).toBe("persisted")
  })

  it("uses complete defaults while retaining invalid/default initialization metadata", () => {
    const memory = createMemoryStorage("{")
    const store = createStudioWorkspaceStore({ storage: memory.storage })

    expect(store.getSnapshot()).toEqual({
      preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
      initialReadStatus: "invalid",
      initialSource: "default",
      latestPersistence: { operation: "idle", status: "idle" },
    })
  })

  it("persists every real action exactly once", () => {
    const memory = createMemoryStorage()
    const store = createStudioWorkspaceStore({ storage: memory.storage })

    expectOneWrite(store, memory.storage, () => store.commitPanelSize("left", 340))
    expectOneWrite(store, memory.storage, () => store.setPanelCollapsed("left", true))
    expectOneWrite(store, memory.storage, () => store.setSelectedTool("components"))

    const canvas: StudioCanvasPreferences = {
      device: "pixel-10-pro",
      orientation: "landscape",
      zoom: 1.5,
      fitMode: "manual",
      locale: "ar",
      forceRTL: true,
      appearance: "dark",
      textScale: 1.25,
      safeArea: false,
      countdownPreviewAt: "2028-06-01T10:30:00Z",
    }
    expectOneWrite(store, memory.storage, () => store.setCanvasPreferences(canvas))
    expectOneWrite(store, memory.storage, () => store.setCanvasPreference("zoom", 1.75))
    expectOneWrite(store, memory.storage, () =>
      store.setCanvasPreference("countdownPreviewAt", "2028-06-02T10:30:00Z"),
    )
    expectOneWrite(store, memory.storage, () =>
      store.setFramePosition("main", { x: 120.25, y: -48.5 }),
    )
    expectOneWrite(store, memory.storage, () => store.setLayerLabel("headline", "Headline"))
    expectOneWrite(store, memory.storage, () => store.removeLayerLabel("headline"))
    expectOneWrite(store, memory.storage, () => store.setLayerLocked("headline", true))
    expectOneWrite(store, memory.storage, () => store.toggleLayerLocked("headline"))
    expectOneWrite(store, memory.storage, () => store.toggleLayerLocked("headline"))
    expectOneWrite(store, memory.storage, () => store.setLayerCanvasHidden("hero-image", true))
    expectOneWrite(store, memory.storage, () => store.toggleLayerCanvasHidden("hero-image"))
    expectOneWrite(store, memory.storage, () => store.toggleLayerCanvasHidden("hero-image"))
    expectOneWrite(store, memory.storage, () => store.recordRecentInsertion("stack"))

    expect(JSON.parse(memory.read() ?? "null")).toEqual(store.getSnapshot().preferences)
  })

  it("rejects invalid and unchanged actions without writing or changing persistence metadata", () => {
    const memory = createMemoryStorage()
    const store = createStudioWorkspaceStore({ storage: memory.storage })
    expect(store.commitPanelSize("left", 340)).toBe(true)
    expect(store.setPanelCollapsed("left", true)).toBe(true)
    expect(store.setSelectedTool("components")).toBe(true)
    expect(store.setCanvasPreference("zoom", 1.5)).toBe(true)
    expect(store.setFramePosition("main", { x: 120.25, y: -48.5 })).toBe(true)
    expect(store.setLayerLabel("headline", "Headline")).toBe(true)
    expect(store.setLayerLocked("headline", true)).toBe(true)
    expect(store.setLayerCanvasHidden("hero-image", true)).toBe(true)
    expect(store.recordRecentInsertion("text")).toBe(true)
    const outcomeBefore = store.getSnapshot().latestPersistence

    expectNoWrite(memory.storage, () => store.commitPanelSize("left", 340))
    expectNoWrite(memory.storage, () => store.commitPanelSize("left", 239))
    expectNoWrite(memory.storage, () => store.commitPanelSize("diagnostics", 1201))
    expectNoWrite(memory.storage, () => store.commitPanelSize("left", Number.NaN))
    expectNoWrite(memory.storage, () => store.setPanelCollapsed("left", true))
    expectNoWrite(memory.storage, () => store.setSelectedTool("components"))
    expectNoWrite(memory.storage, () =>
      store.setSelectedTool("future-tool" as StudioWorkspacePreferencesV1["selectedTool"]),
    )
    expectNoWrite(memory.storage, () => store.setCanvasPreference("zoom", 1.5))
    expectNoWrite(memory.storage, () => store.setCanvasPreference("zoom", Infinity))
    expectNoWrite(memory.storage, () => store.setFramePosition("main", { x: 120.25, y: -48.5 }))
    expectNoWrite(memory.storage, () => store.setFramePosition("main", { x: Number.NaN, y: 0 }))
    expectNoWrite(memory.storage, () => store.setFramePosition("Bad screen ID", { x: 0, y: 0 }))
    expectNoWrite(memory.storage, () =>
      store.setCanvasPreference("countdownPreviewAt", "2028-02-31T10:30:00Z"),
    )
    expectNoWrite(memory.storage, () =>
      store.setCanvasPreferences({
        ...store.getSnapshot().preferences.canvas,
        locale: "not-a-locale",
      }),
    )
    expectNoWrite(memory.storage, () => store.setLayerLabel("headline", "Headline"))
    expectNoWrite(memory.storage, () => store.setLayerLabel("Bad ID", "Label"))
    expectNoWrite(memory.storage, () => store.removeLayerLabel("missing"))
    expectNoWrite(memory.storage, () => store.setLayerLocked("headline", true))
    expectNoWrite(memory.storage, () => store.setLayerCanvasHidden("hero-image", true))
    expectNoWrite(memory.storage, () => store.recordRecentInsertion("text"))
    expectNoWrite(memory.storage, () =>
      store.recordRecentInsertion("scrollContainer" as StudioRecentInsertableType),
    )

    expect(store.getSnapshot().latestPersistence).toBe(outcomeBefore)
  })

  it("commits bounded panel pixels only through the completed-size action", () => {
    const memory = createMemoryStorage()
    const store = createStudioWorkspaceStore({ storage: memory.storage })

    expect(store.commitPanelSize("left", 240)).toBe(true)
    expect(store.commitPanelSize("properties", 560)).toBe(true)
    expect(store.commitPanelSize("diagnostics", 1200)).toBe(true)
    expect(store.getSnapshot().preferences.panels).toEqual({
      left: { size: 240, collapsed: false },
      properties: { size: 560, collapsed: false },
      diagnostics: { size: 1200, collapsed: false },
    })
  })

  it("commits a completed panel size and collapsed state atomically", () => {
    const memory = createMemoryStorage()
    const store = createStudioWorkspaceStore({ storage: memory.storage })

    expectOneWrite(store, memory.storage, () =>
      store.commitPanelLayout("left", { size: 340, collapsed: true }),
    )
    expect(store.getSnapshot().preferences.panels.left).toEqual({
      size: 340,
      collapsed: true,
    })
    expectNoWrite(memory.storage, () =>
      store.commitPanelLayout("left", { size: 340, collapsed: true }),
    )
    expectNoWrite(memory.storage, () =>
      store.commitPanelLayout("left", { size: 239, collapsed: false }),
    )
  })

  it("keeps recent insertions unique, ordered, and bounded to five", () => {
    const memory = createMemoryStorage()
    const store = createStudioWorkspaceStore({ storage: memory.storage })

    for (const type of STUDIO_RECENT_INSERTABLE_TYPES.slice(0, 7)) {
      expect(store.recordRecentInsertion(type)).toBe(true)
    }
    const expectedRecentInsertions = STUDIO_RECENT_INSERTABLE_TYPES.slice(0, 7)
      .reverse()
      .slice(0, 5)
    expect(store.getSnapshot().preferences.recentInsertions).toEqual(expectedRecentInsertions)

    const writesBeforeMove = vi.mocked(memory.storage.setItem).mock.calls.length
    const movedType = expectedRecentInsertions[2]!
    expect(store.recordRecentInsertion(movedType)).toBe(true)
    expect(vi.mocked(memory.storage.setItem)).toHaveBeenCalledTimes(writesBeforeMove + 1)
    expect(store.getSnapshot().preferences.recentInsertions).toEqual([
      movedType,
      ...expectedRecentInsertions.filter((type) => type !== movedType),
    ])

    expectNoWrite(memory.storage, () => store.recordRecentInsertion(movedType))
  })

  it("sets, removes, and toggles Studio-only layer metadata", () => {
    const store = createStudioWorkspaceStore({ storage: null })

    expect(store.setLayerLabel("headline", "Primary headline")).toBe(true)
    expect(store.getSnapshot().preferences.layerMetadata.labels).toEqual({
      headline: "Primary headline",
    })
    expect(store.removeLayerLabel("headline")).toBe(true)
    expect(store.getSnapshot().preferences.layerMetadata.labels).toEqual({})

    expect(store.toggleLayerLocked("headline")).toBe(true)
    expect(store.getSnapshot().preferences.layerMetadata.lockedIds).toEqual(["headline"])
    expect(store.toggleLayerLocked("headline")).toBe(true)
    expect(store.getSnapshot().preferences.layerMetadata.lockedIds).toEqual([])

    expect(store.toggleLayerCanvasHidden("hero-image")).toBe(true)
    expect(store.getSnapshot().preferences.layerMetadata.canvasHiddenIds).toEqual(["hero-image"])
    expect(store.toggleLayerCanvasHidden("hero-image")).toBe(true)
    expect(store.getSnapshot().preferences.layerMetadata.canvasHiddenIds).toEqual([])
  })

  it("persists per-screen canvas frame positions as workspace-only state", () => {
    const memory = createMemoryStorage()
    const store = createStudioWorkspaceStore({ storage: memory.storage })

    expect(store.setFramePosition("main", { x: 120.25, y: -48.5 })).toBe(true)
    expect(store.setFramePosition("upgrade-sheet", { x: 720, y: 64 })).toBe(true)
    expect(store.getSnapshot().preferences.framePositions).toEqual({
      main: { x: 120.25, y: -48.5 },
      "upgrade-sheet": { x: 720, y: 64 },
    })

    const restored = createStudioWorkspaceStore({ storage: memory.storage })
    expect(restored.getSnapshot().preferences.framePositions).toEqual(
      store.getSnapshot().preferences.framePositions,
    )
  })

  it("keeps usable in-memory mutations when writes fail or storage is unavailable", () => {
    const failedStorage: StudioWorkspaceStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError")
      }),
      removeItem: vi.fn(),
    }
    const failedStore = createStudioWorkspaceStore({ storage: failedStorage })
    expect(() => failedStore.setSelectedTool("settings")).not.toThrow()
    expect(failedStore.getSnapshot().preferences.selectedTool).toBe("settings")
    expect(failedStore.getSnapshot().latestPersistence).toEqual({
      operation: "write",
      status: "failed",
    })

    const unavailableStore = createStudioWorkspaceStore({ storage: null })
    expect(unavailableStore.setSelectedTool("settings")).toBe(true)
    expect(unavailableStore.getSnapshot().preferences.selectedTool).toBe("settings")
    expect(unavailableStore.getSnapshot().latestPersistence).toEqual({
      operation: "write",
      status: "unavailable",
    })
  })

  it("restores complete defaults even when persisted-key removal fails", () => {
    const storage: StudioWorkspaceStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new DOMException("Storage disabled", "SecurityError")
      }),
    }
    const store = createStudioWorkspaceStore({ storage })
    store.setSelectedTool("settings")
    store.setLayerLabel("headline", "Headline")

    expect(() => store.resetWorkspace()).not.toThrow()
    expect(store.getSnapshot().preferences).toBe(DEFAULT_STUDIO_WORKSPACE_PREFERENCES)
    expect(store.getSnapshot().latestPersistence).toEqual({
      operation: "reset",
      status: "failed",
    })
    expect(storage.removeItem).toHaveBeenCalledTimes(1)
  })

  it("removes persisted state on reset and retains initial read metadata", () => {
    const memory = createMemoryStorage(JSON.stringify(persistedPreferences()))
    const store = createStudioWorkspaceStore({ storage: memory.storage })

    store.setSelectedTool("settings")
    store.resetWorkspace()

    expect(memory.storage.removeItem).toHaveBeenCalledTimes(1)
    expect(memory.read()).toBeNull()
    expect(store.getSnapshot()).toEqual({
      preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
      initialReadStatus: "valid",
      initialSource: "persisted",
      latestPersistence: { operation: "reset", status: "reset" },
    })
  })

  it("never mutates editor state, history, revisions, or portable document JSON", () => {
    const editorStore = createEditorStore()
    editorStore.loadTemplate(canonicalFixture as MosaicDocument)
    const before = editorStore.getSnapshot()
    if (!before.document) throw new Error("Expected a loaded editor document")
    const serializedBefore = serializeDocument(before.document)

    const workspaceStore = createStudioWorkspaceStore({ storage: null })
    workspaceStore.commitPanelSize("left", 340)
    workspaceStore.setPanelCollapsed("diagnostics", true)
    workspaceStore.setSelectedTool("settings")
    workspaceStore.setCanvasPreferences({
      ...workspaceStore.getSnapshot().preferences.canvas,
      device: "ipad-pro-13",
      orientation: "landscape",
      zoom: 1.5,
      fitMode: "manual",
      locale: "ar",
      forceRTL: true,
      appearance: "dark",
      safeArea: false,
      countdownPreviewAt: "2031-04-05T06:07:08Z",
    })
    workspaceStore.setLayerLabel("headline", "Studio-only label")
    workspaceStore.setFramePosition("main", { x: 120.25, y: -48.5 })
    workspaceStore.setLayerLocked("headline", true)
    workspaceStore.setLayerCanvasHidden("hero-image", true)
    workspaceStore.recordRecentInsertion("stack")

    const after = editorStore.getSnapshot()
    expect(after.document).toBe(before.document)
    expect(after.document?.revision).toBe(before.document.revision)
    expect(after.dirty).toBe(before.dirty)
    expect(after.undoStack).toBe(before.undoStack)
    expect(after.redoStack).toBe(before.redoStack)
    expect(after.localRevisionSequence).toBe(before.localRevisionSequence)

    const serializedAfter = serializeDocument(after.document as MosaicDocument)
    expect(serializedAfter).toBe(serializedBefore)
    expect(serializedAfter).not.toContain(STUDIO_WORKSPACE_STORAGE_KEY)
    expect(serializedAfter).not.toContain("Studio-only label")
    expect(serializedAfter).not.toContain('"settings"')
    expect(serializedAfter).not.toContain('"ipad-pro-13"')
    expect(serializedAfter).not.toContain('"manual"')
    const keys = collectObjectKeys(JSON.parse(serializedAfter))
    for (const workspaceKey of [
      "workspace",
      "panels",
      "selectedTool",
      "canvas",
      "framePositions",
      "layerMetadata",
      "recentInsertions",
      "forceRTL",
      "fitMode",
      "countdownPreviewAt",
    ]) {
      expect(keys).not.toContain(workspaceKey)
    }
  })
})
