import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"

export function useEditorHistory() {
  const { undoStack, redoStack } = useEditorStore()
  const { undo, redo } = useEditorActions()

  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undo,
    redo,
  }
}
