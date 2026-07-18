import { useEffect, useRef } from "react"

import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"
import type {
  StudioTool,
  StudioWorkspacePanel,
} from "@/features/paywall-editor/types/studio-workspace"

export const STUDIO_SHORTCUT_HINTS = Object.freeze({
  appearance: "Shift A",
  commandPalette: "⌘/Ctrl Shift K",
  deleteSelection: "Delete",
  duplicateSelection: "Alt Shift D",
  fitCanvas: "F",
  openComponents: "G then C",
  openLayers: "G then L",
  openLocalization: "G then O",
  openProducts: "G then P",
  redo: "⌘/Ctrl Shift Z",
  resetZoom: "Shift 0",
  toggleDiagnostics: "\\",
  toggleLeft: "[",
  toggleProperties: "]",
  undo: "⌘/Ctrl Z",
})

const TOOL_CHORDS: Readonly<Record<string, StudioTool>> = Object.freeze({
  c: "components",
  l: "layers",
  o: "localization",
  p: "products",
})
const CHORD_TIMEOUT_MS = 1_200

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  )
}

export interface EditorKeyboardShortcutHandlers {
  readonly onFitCanvas?: () => void
  readonly onOpenCommandPalette?: () => void
  readonly onOpenTool?: (tool: StudioTool) => void
  readonly onResetZoom?: () => void
  readonly onToggleAppearance?: () => void
  readonly onTogglePanel?: (panel: StudioWorkspacePanel) => void
}

export function useEditorKeyboardShortcuts(handlers: EditorKeyboardShortcutHandlers = {}) {
  const editor = useEditorActions()
  const handlersRef = useRef(handlers)
  const chordRef = useRef<"g" | null>(null)
  const chordTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) {
        chordRef.current = null
        return
      }

      const modifier = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (chordRef.current === "g") {
        chordRef.current = null
        if (chordTimeoutRef.current !== null) {
          window.clearTimeout(chordTimeoutRef.current)
          chordTimeoutRef.current = null
        }
        const tool = TOOL_CHORDS[key]
        if (tool && !modifier && !event.altKey) {
          handlersRef.current.onOpenTool?.(tool)
          event.preventDefault()
        }
        return
      }

      if (key === "g" && !modifier && !event.altKey && !event.shiftKey) {
        chordRef.current = "g"
        if (chordTimeoutRef.current !== null) {
          window.clearTimeout(chordTimeoutRef.current)
        }
        chordTimeoutRef.current = window.setTimeout(() => {
          chordRef.current = null
          chordTimeoutRef.current = null
        }, CHORD_TIMEOUT_MS)
        event.preventDefault()
        return
      }

      if (modifier && event.shiftKey && key === "k") {
        handlersRef.current.onOpenCommandPalette?.()
        event.preventDefault()
        return
      }

      const snapshot = editor.getSnapshot()
      if (modifier && key === "z") {
        if (event.shiftKey && snapshot.redoStack.length > 0) editor.redo()
        else if (snapshot.undoStack.length > 0) editor.undo()
        event.preventDefault()
        return
      }
      if (modifier && key === "y" && snapshot.redoStack.length > 0) {
        editor.redo()
        event.preventDefault()
        return
      }
      if (event.altKey && event.shiftKey && key === "d") {
        editor.duplicateSelectedComponent()
        event.preventDefault()
        return
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !modifier) {
        editor.removeSelectedComponent()
        event.preventDefault()
        return
      }
      if (modifier && event.key === "ArrowUp") {
        editor.moveSelectedComponent(-1)
        event.preventDefault()
        return
      }
      if (modifier && event.key === "ArrowDown") {
        editor.moveSelectedComponent(1)
        event.preventDefault()
        return
      }

      if (!modifier && !event.altKey && !event.shiftKey && event.key === "[") {
        handlersRef.current.onTogglePanel?.("left")
        event.preventDefault()
      } else if (!modifier && !event.altKey && !event.shiftKey && event.key === "]") {
        handlersRef.current.onTogglePanel?.("properties")
        event.preventDefault()
      } else if (!modifier && !event.altKey && !event.shiftKey && event.key === "\\") {
        handlersRef.current.onTogglePanel?.("diagnostics")
        event.preventDefault()
      } else if (!modifier && !event.altKey && !event.shiftKey && key === "f") {
        handlersRef.current.onFitCanvas?.()
        event.preventDefault()
      } else if (
        !modifier &&
        !event.altKey &&
        event.shiftKey &&
        (event.code === "Digit0" || event.key === ")" || event.key === "0")
      ) {
        handlersRef.current.onResetZoom?.()
        event.preventDefault()
      } else if (!modifier && !event.altKey && event.shiftKey && key === "a") {
        handlersRef.current.onToggleAppearance?.()
        event.preventDefault()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      if (chordTimeoutRef.current !== null) window.clearTimeout(chordTimeoutRef.current)
    }
  }, [editor])
}
