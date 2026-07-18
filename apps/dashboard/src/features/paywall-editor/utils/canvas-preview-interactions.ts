import type {
  LocalizedText,
  MosaicDocument,
  ProtocolNode,
} from "@/features/paywall-editor/types/editor"
import { findAncestorNodeIds } from "@/features/paywall-editor/utils/document-tree"

export function getEditableCanvasText(node: ProtocolNode): {
  ariaLabel: string
  multiline: boolean
  property: "label" | "value"
  text: LocalizedText
} | null {
  switch (node.type) {
    case "text":
      return {
        ariaLabel: node.typography.style === "title" ? "Edit headline inline" : "Edit text inline",
        multiline: true,
        property: "value",
        text: node.value,
      }
    case "switch":
      return {
        ariaLabel: "Edit switch label inline",
        multiline: false,
        property: "label",
        text: node.label,
      }
    default:
      return null
  }
}

export function canvasNodeIsUnavailable(
  document: MosaicDocument,
  nodeId: string,
  unavailableIds: ReadonlySet<string>,
) {
  return (
    unavailableIds.has(nodeId) ||
    findAncestorNodeIds(document, nodeId).some((ancestorId) => unavailableIds.has(ancestorId))
  )
}
