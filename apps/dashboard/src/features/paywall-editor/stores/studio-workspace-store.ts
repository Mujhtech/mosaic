import {
  DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
  STUDIO_RECENT_INSERTIONS_MAX,
} from "@/features/paywall-editor/constants/studio-workspace"
import {
  parseStudioWorkspacePreferences,
  readStudioWorkspacePreferences,
  resetStudioWorkspacePreferences,
  writeStudioWorkspacePreferences,
  type StudioWorkspaceStorage,
} from "@/features/paywall-editor/mutations/studio-workspace-persistence"
import type {
  StudioCanvasPreferences,
  StudioCanvasFramePosition,
  StudioRecentInsertableType,
  StudioTool,
  StudioWorkspacePanel,
  StudioWorkspacePanelPreference,
  StudioWorkspacePreferencesV1,
  StudioWorkspaceReadResult,
  StudioWorkspaceResetResult,
  StudioWorkspaceWriteResult,
} from "@/features/paywall-editor/types/studio-workspace"

export type StudioWorkspacePersistenceOutcome =
  | { readonly operation: "idle"; readonly status: "idle" }
  | {
      readonly operation: "write"
      readonly status: StudioWorkspaceWriteResult["status"]
    }
  | {
      readonly operation: "reset"
      readonly status: StudioWorkspaceResetResult["status"]
    }

export interface StudioWorkspaceSnapshot {
  readonly preferences: StudioWorkspacePreferencesV1
  readonly initialReadStatus: StudioWorkspaceReadResult["status"]
  readonly initialSource: StudioWorkspaceReadResult["source"]
  readonly latestPersistence: StudioWorkspacePersistenceOutcome
}

export interface StudioWorkspaceActions {
  commitPanelLayout: (
    panel: StudioWorkspacePanel,
    preference: StudioWorkspacePanelPreference,
  ) => boolean
  commitPanelSize: (panel: StudioWorkspacePanel, size: number) => boolean
  setPanelCollapsed: (panel: StudioWorkspacePanel, collapsed: boolean) => boolean
  setSelectedTool: (tool: StudioTool) => boolean
  setCanvasPreferences: (preferences: StudioCanvasPreferences) => boolean
  setCanvasPreference: <Key extends keyof StudioCanvasPreferences>(
    key: Key,
    value: StudioCanvasPreferences[Key],
  ) => boolean
  setFramePosition: (screenId: string, position: StudioCanvasFramePosition) => boolean
  setLayerLabel: (componentId: string, label: string) => boolean
  removeLayerLabel: (componentId: string) => boolean
  setLayerLocked: (componentId: string, locked: boolean) => boolean
  toggleLayerLocked: (componentId: string) => boolean
  setLayerCanvasHidden: (componentId: string, hidden: boolean) => boolean
  toggleLayerCanvasHidden: (componentId: string) => boolean
  recordRecentInsertion: (type: StudioRecentInsertableType) => boolean
  resetWorkspace: () => void
}

export interface StudioWorkspaceStore extends StudioWorkspaceActions {
  getSnapshot: () => StudioWorkspaceSnapshot
  subscribe: (listener: () => void) => () => void
}

interface CreateStudioWorkspaceStoreOptions {
  storage?: StudioWorkspaceStorage | null
}

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
] as const satisfies readonly (keyof StudioCanvasPreferences)[]
const CANVAS_KEY_SET = new Set<PropertyKey>(CANVAS_KEYS)
const IDLE_PERSISTENCE = Object.freeze({
  operation: "idle",
  status: "idle",
}) satisfies StudioWorkspacePersistenceOutcome

function canvasPreferencesEqual(left: StudioCanvasPreferences, right: StudioCanvasPreferences) {
  return CANVAS_KEYS.every((key) => left[key] === right[key])
}

export function createStudioWorkspaceStore(
  options: CreateStudioWorkspaceStoreOptions = {},
): StudioWorkspaceStore {
  const storage = options.storage
  const initial =
    storage === undefined
      ? readStudioWorkspacePreferences()
      : readStudioWorkspacePreferences(storage)
  let snapshot: StudioWorkspaceSnapshot = Object.freeze({
    preferences: initial.preferences,
    initialReadStatus: initial.status,
    initialSource: initial.source,
    latestPersistence: IDLE_PERSISTENCE,
  })
  const listeners = new Set<() => void>()

  function notify() {
    listeners.forEach((listener) => listener())
  }

  function persistPreferences(preferences: StudioWorkspacePreferencesV1) {
    const result =
      storage === undefined
        ? writeStudioWorkspacePreferences(preferences)
        : writeStudioWorkspacePreferences(preferences, storage)
    snapshot = Object.freeze({
      preferences,
      initialReadStatus: snapshot.initialReadStatus,
      initialSource: snapshot.initialSource,
      latestPersistence: Object.freeze({ operation: "write", status: result.status }),
    })
    notify()
    return true
  }

  function commitCandidate(candidate: unknown) {
    const result = parseStudioWorkspacePreferences(candidate)
    if (result.status === "invalid") return false
    return persistPreferences(result.preferences)
  }

  function setIdState(key: "lockedIds" | "canvasHiddenIds", componentId: string, enabled: boolean) {
    if (typeof componentId !== "string" || typeof enabled !== "boolean") return false
    const current = snapshot.preferences.layerMetadata[key]
    const includesId = current.includes(componentId)
    if (includesId === enabled) return false
    const next = enabled
      ? [...current, componentId]
      : current.filter((existingId) => existingId !== componentId)
    return commitCandidate({
      ...snapshot.preferences,
      layerMetadata: { ...snapshot.preferences.layerMetadata, [key]: next },
    })
  }

  const actions: StudioWorkspaceActions = {
    commitPanelLayout: (panel, preference) => {
      if (
        typeof panel !== "string" ||
        !Object.hasOwn(snapshot.preferences.panels, panel) ||
        !preference ||
        typeof preference !== "object" ||
        typeof preference.size !== "number" ||
        typeof preference.collapsed !== "boolean"
      ) {
        return false
      }

      const current = snapshot.preferences.panels[panel]
      if (current.size === preference.size && current.collapsed === preference.collapsed) {
        return false
      }

      return commitCandidate({
        ...snapshot.preferences,
        panels: {
          ...snapshot.preferences.panels,
          [panel]: preference,
        },
      })
    },
    commitPanelSize: (panel, size) => {
      if (
        typeof panel !== "string" ||
        !Object.hasOwn(snapshot.preferences.panels, panel) ||
        typeof size !== "number" ||
        snapshot.preferences.panels[panel].size === size
      ) {
        return false
      }
      return commitCandidate({
        ...snapshot.preferences,
        panels: {
          ...snapshot.preferences.panels,
          [panel]: { ...snapshot.preferences.panels[panel], size },
        },
      })
    },
    setPanelCollapsed: (panel, collapsed) => {
      if (
        typeof panel !== "string" ||
        !Object.hasOwn(snapshot.preferences.panels, panel) ||
        typeof collapsed !== "boolean" ||
        snapshot.preferences.panels[panel].collapsed === collapsed
      ) {
        return false
      }
      return commitCandidate({
        ...snapshot.preferences,
        panels: {
          ...snapshot.preferences.panels,
          [panel]: { ...snapshot.preferences.panels[panel], collapsed },
        },
      })
    },
    setSelectedTool: (selectedTool) => {
      if (typeof selectedTool !== "string" || snapshot.preferences.selectedTool === selectedTool) {
        return false
      }
      return commitCandidate({ ...snapshot.preferences, selectedTool })
    },
    setCanvasPreferences: (canvas) => {
      const result = parseStudioWorkspacePreferences({ ...snapshot.preferences, canvas })
      if (
        result.status === "invalid" ||
        canvasPreferencesEqual(snapshot.preferences.canvas, result.preferences.canvas)
      ) {
        return false
      }
      return persistPreferences(result.preferences)
    },
    setCanvasPreference: (key, value) => {
      if (!CANVAS_KEY_SET.has(key) || Object.is(snapshot.preferences.canvas[key], value)) {
        return false
      }
      return commitCandidate({
        ...snapshot.preferences,
        canvas: { ...snapshot.preferences.canvas, [key]: value },
      })
    },
    setFramePosition: (screenId, position) => {
      if (
        typeof screenId !== "string" ||
        !position ||
        typeof position !== "object" ||
        typeof position.x !== "number" ||
        typeof position.y !== "number"
      ) {
        return false
      }
      const current = snapshot.preferences.framePositions[screenId]
      if (current?.x === position.x && current.y === position.y) return false
      return commitCandidate({
        ...snapshot.preferences,
        framePositions: {
          ...snapshot.preferences.framePositions,
          [screenId]: position,
        },
      })
    },
    setLayerLabel: (componentId, label) => {
      if (typeof componentId !== "string" || typeof label !== "string") return false
      if (snapshot.preferences.layerMetadata.labels[componentId] === label) return false
      return commitCandidate({
        ...snapshot.preferences,
        layerMetadata: {
          ...snapshot.preferences.layerMetadata,
          labels: { ...snapshot.preferences.layerMetadata.labels, [componentId]: label },
        },
      })
    },
    removeLayerLabel: (componentId) => {
      if (
        typeof componentId !== "string" ||
        !Object.hasOwn(snapshot.preferences.layerMetadata.labels, componentId)
      ) {
        return false
      }
      const labels = { ...snapshot.preferences.layerMetadata.labels }
      delete labels[componentId]
      return commitCandidate({
        ...snapshot.preferences,
        layerMetadata: { ...snapshot.preferences.layerMetadata, labels },
      })
    },
    setLayerLocked: (componentId, locked) => setIdState("lockedIds", componentId, locked),
    toggleLayerLocked: (componentId) => {
      if (typeof componentId !== "string") return false
      return setIdState(
        "lockedIds",
        componentId,
        !snapshot.preferences.layerMetadata.lockedIds.includes(componentId),
      )
    },
    setLayerCanvasHidden: (componentId, hidden) =>
      setIdState("canvasHiddenIds", componentId, hidden),
    toggleLayerCanvasHidden: (componentId) => {
      if (typeof componentId !== "string") return false
      return setIdState(
        "canvasHiddenIds",
        componentId,
        !snapshot.preferences.layerMetadata.canvasHiddenIds.includes(componentId),
      )
    },
    recordRecentInsertion: (type) => {
      if (typeof type !== "string" || snapshot.preferences.recentInsertions[0] === type) {
        return false
      }
      const recentInsertions = [
        type,
        ...snapshot.preferences.recentInsertions.filter((entry) => entry !== type),
      ].slice(0, STUDIO_RECENT_INSERTIONS_MAX)
      return commitCandidate({ ...snapshot.preferences, recentInsertions })
    },
    resetWorkspace: () => {
      const result =
        storage === undefined
          ? resetStudioWorkspacePreferences()
          : resetStudioWorkspacePreferences(storage)
      snapshot = Object.freeze({
        preferences: DEFAULT_STUDIO_WORKSPACE_PREFERENCES,
        initialReadStatus: snapshot.initialReadStatus,
        initialSource: snapshot.initialSource,
        latestPersistence: Object.freeze({ operation: "reset", status: result.status }),
      })
      notify()
    },
  }

  return {
    ...actions,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
