import { useEffect } from "react"

import { useEditorHistory } from "@/features/paywall-editor/hooks/use-editor-history"
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context"

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function useEditorKeyboardShortcuts() {
  const { canRedo, canUndo, redo, undo } = useEditorHistory()
  const { removeSelectedComponent, moveSelectedComponent } = useEditorActions()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === "z") {
        if (event.shiftKey && canRedo) redo()
        else if (canUndo) undo()
        event.preventDefault()
        return
      }
      if (modifier && event.key.toLowerCase() === "y" && canRedo) {
        redo()
        event.preventDefault()
        return
      }
      if (isEditableTarget(event.target)) return
      if ((event.key === "Backspace" || event.key === "Delete") && !modifier) {
        removeSelectedComponent()
        event.preventDefault()
      }
      if (modifier && event.key === "ArrowUp") {
        moveSelectedComponent(-1)
        event.preventDefault()
      }
      if (modifier && event.key === "ArrowDown") {
        moveSelectedComponent(1)
        event.preventDefault()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [canRedo, canUndo, moveSelectedComponent, redo, removeSelectedComponent, undo])
}
