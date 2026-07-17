import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

export function useEditorSelection() {
  const { document, selectedComponentId, hoveredComponentId } = useEditorStore()
  const { selectComponent, hoverComponent } = useEditorActions()

  return {
    selectedComponentId,
    hoveredComponentId,
    selectedComponent: document ? findNode(document, selectedComponentId) : null,
    selectComponent,
    hoverComponent,
  }
}
