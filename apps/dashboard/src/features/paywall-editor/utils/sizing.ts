import type { MosaicDocument, ProtocolNode } from "@/features/paywall-editor/types/editor"
import { findParent } from "@/features/paywall-editor/utils/document-tree"

export type SizingAxis = "width" | "height"

function containerDirection(node: ProtocolNode | undefined) {
  if (
    node &&
    (node.type === "stack" ||
      node.type === "button" ||
      node.type === "productSelector" ||
      node.type === "productCard" ||
      node.type === "productBadge")
  ) {
    return node.direction
  }
  return null
}

export function fillAxisIsBounded(document: MosaicDocument, node: ProtocolNode, axis: SizingAxis) {
  const isRootContent = document.screens.some((screen) => screen.layout.content.id === node.id)
  if (isRootContent) return axis === "width"

  const direction = containerDirection(findParent(document, node.id)?.parent)
  if (!direction) return false
  return axis === "width" ? direction === "vertical" : direction === "horizontal"
}

export function fixedSizingClipsOverflow(node: ProtocolNode) {
  if (!("sizing" in node) || !node.sizing) return false
  return typeof node.sizing.width === "object" || typeof node.sizing.height === "object"
}
