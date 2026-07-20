/* eslint-disable react-refresh/only-export-components -- internal tree support deliberately colocates private menu components with the rules they render. */
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { ArrowLineLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLineLeft"
import { ArrowLineRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowLineRight"
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye"
import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr/EyeSlash"
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock"
import { LockOpenIcon } from "@phosphor-icons/react/dist/ssr/LockOpen"
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"
import type { DragEvent } from "react"

import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import {
  COMPONENT_LIBRARY_DRAG_TYPE,
  LAYER_TYPE_LABELS,
} from "@/features/paywall-editor/components/component-catalog"
import type { EditorState } from "@/features/paywall-editor/stores/editor-store"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import type {
  MosaicDocument,
  PreviewClient,
  ProtocolNode,
  RequiredCapability,
  TreeInsertionLocation,
  TreeMoveTarget,
  TreeOperationResult,
} from "@/features/paywall-editor/types/editor"
import { findAncestorNodeIds } from "@/features/paywall-editor/utils/document-tree"

export function hasCatalogPayload(event: DragEvent<HTMLDivElement>) {
  return (
    Array.from(event.dataTransfer.types ?? []).includes(COMPONENT_LIBRARY_DRAG_TYPE) ||
    Boolean(event.dataTransfer.getData(COMPONENT_LIBRARY_DRAG_TYPE))
  )
}

export const LAYER_DRAG_TYPE = "application/x-mosaic-layer-id"

export const CAPABILITY_BY_TYPE = {
  scrollContainer: "layout.scrollContainer",
  stack: "layout.stack",
  text: "component.text",
  image: "component.image",
  icon: "component.icon",
  featureList: "component.featureList",
  productSelector: "component.productSelector",
  productCard: "component.productCard",
  productBadge: "component.productBadge",
  button: "component.button",
  carousel: "component.carousel",
  switch: "component.switch",
  countdown: "component.countdown",
} as const

export const selectTreeState = (state: EditorState) => ({
  document: state.document,
  expandedTreeNodes: state.expandedTreeNodes,
  hoveredComponentId: state.hoveredComponentId,
  isDocumentTransactionActive: state.isDocumentTransactionActive,
  selectedComponentId: state.selectedComponentId,
})
export const selectLayerMetadata = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.layerMetadata

export type TreeRow =
  | {
      readonly kind: "scroll"
      readonly id: string
      readonly screenId: string
      readonly presentation: "screen" | "sheet"
      readonly depth: number
      readonly parentId: null
    }
  | {
      readonly kind: "component"
      readonly id: string
      readonly depth: number
      readonly parentId: string
      readonly node: ProtocolNode
      readonly progress?: boolean
    }

export interface DropPreview {
  readonly key: string
  readonly target: TreeMoveTarget
  readonly result: TreeOperationResult
}

export interface RowDropTarget {
  readonly key: string
  readonly target: TreeMoveTarget
}

export interface PointerLayerDrag {
  active: boolean
  readonly pointerId: number
  readonly sourceId: string
  readonly startX: number
  readonly startY: number
}

export interface OperationNotice {
  readonly tone: "success" | "danger"
  readonly title: string
  readonly detail: string
}

export interface CatalogDropPreview {
  readonly rowId: string
  readonly location: TreeInsertionLocation | null
  readonly blocked: boolean
  readonly label: string
}

export interface LayerIssueSummary {
  errorCount: number
  warningCount: number
}

export interface LayerActionItemsProps {
  readonly availability: {
    readonly delete: boolean
    readonly duplicate: boolean
    readonly indent: boolean
    readonly moveDown: boolean
    readonly moveUp: boolean
    readonly outdent: boolean
  }
  readonly state: { readonly hidden: boolean; readonly locked: boolean }
  readonly onDelete: () => void
  readonly onDuplicate: () => void
  readonly onIndent: () => void
  readonly onMoveDown: () => void
  readonly onMoveUp: () => void
  readonly onOutdent: () => void
  readonly onRename: () => void
  readonly onToggleHidden: () => void
  readonly onToggleLocked: () => void
}

export const EMPTY_LAYER_ISSUE_SUMMARY: LayerIssueSummary = { errorCount: 0, warningCount: 0 }

export function supportsCapability(client: PreviewClient, requirement: RequiredCapability) {
  return client.supportedCapabilities.some(
    (capability) =>
      capability.name === requirement.name && capability.version === requirement.version,
  )
}

export function validationStatusLabel(summary: LayerIssueSummary) {
  const errors = `${summary.errorCount} validation ${summary.errorCount === 1 ? "error" : "errors"}`
  if (summary.warningCount === 0) return errors
  return `${errors} and ${summary.warningCount} ${summary.warningCount === 1 ? "warning" : "warnings"}`
}

export function rowLabel(row: TreeRow, labels: Readonly<Record<string, string>>) {
  if (row.kind === "scroll") {
    return (
      labels[row.screenId]?.trim() ||
      `${row.presentation === "sheet" ? "Sheet" : "Screen"} · ${row.screenId}`
    )
  }
  const customLabel = labels[row.id]?.trim()
  if (customLabel) return row.progress ? `In progress · ${customLabel}` : customLabel
  if (row.parentId === row.id) return "Content Stack"
  const label = defaultNodeLabel(row.node)
  return row.progress ? `In progress · ${label}` : label
}

export function defaultNodeLabel(node: ProtocolNode) {
  if (node.type !== "button") return LAYER_TYPE_LABELS[node.type]
  switch (node.action.type) {
    case "purchase":
      return "Purchase"
    case "restore":
      return "Restore"
    case "close":
      return "Close"
    case "navigateTo":
      return "Navigate to screen"
    case "navigateBack":
      return "Navigate back"
    case "openExternalUrl":
      return "Open external URL"
  }
}

export function componentLabel(
  node: ProtocolNode,
  rootContentIds: ReadonlySet<string>,
  labels: Readonly<Record<string, string>>,
) {
  const customLabel = labels[node.id]?.trim()
  if (customLabel) return customLabel
  return rootContentIds.has(node.id) ? "Content Stack" : defaultNodeLabel(node)
}

export function LayerActionItems({
  availability,
  state,
  onDelete,
  onDuplicate,
  onIndent,
  onMoveDown,
  onMoveUp,
  onOutdent,
  onRename,
  onToggleHidden,
  onToggleLocked,
}: LayerActionItemsProps) {
  return (
    <>
      <DropdownMenuItem onClick={onRename}>
        <PencilSimpleIcon aria-hidden /> Rename layer
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!availability.moveUp} onClick={onMoveUp}>
        <ArrowUpIcon aria-hidden /> Move up
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!availability.moveDown} onClick={onMoveDown}>
        <ArrowDownIcon aria-hidden /> Move down
      </DropdownMenuItem>
      {availability.indent ? (
        <DropdownMenuItem onClick={onIndent}>
          <ArrowLineRightIcon aria-hidden /> Indent
        </DropdownMenuItem>
      ) : null}
      {availability.outdent ? (
        <DropdownMenuItem onClick={onOutdent}>
          <ArrowLineLeftIcon aria-hidden /> Outdent
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem disabled={!availability.duplicate} onClick={onDuplicate}>
        <CopyIcon aria-hidden /> Duplicate
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onToggleLocked}>
        {state.locked ? <LockOpenIcon aria-hidden /> : <LockIcon aria-hidden />}
        {state.locked ? "Unlock canvas layer" : "Lock canvas layer"}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={onToggleHidden}>
        {state.hidden ? <EyeIcon aria-hidden /> : <EyeSlashIcon aria-hidden />}
        {state.hidden ? "Show on canvas" : "Hide on canvas"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!availability.delete} onClick={onDelete} variant="destructive">
        <TrashIcon aria-hidden /> Delete
      </DropdownMenuItem>
    </>
  )
}

export const contextMenuItemClass =
  "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-none select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"

export function ContextLayerActionItems(props: LayerActionItemsProps) {
  return (
    <>
      <ContextMenuPrimitive.Item className={contextMenuItemClass} onClick={props.onRename}>
        <PencilSimpleIcon aria-hidden /> Rename layer
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />
      <ContextMenuPrimitive.Item
        className={contextMenuItemClass}
        disabled={!props.availability.moveUp}
        onClick={props.onMoveUp}
      >
        <ArrowUpIcon aria-hidden /> Move up
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Item
        className={contextMenuItemClass}
        disabled={!props.availability.moveDown}
        onClick={props.onMoveDown}
      >
        <ArrowDownIcon aria-hidden /> Move down
      </ContextMenuPrimitive.Item>
      {props.availability.indent ? (
        <ContextMenuPrimitive.Item className={contextMenuItemClass} onClick={props.onIndent}>
          <ArrowLineRightIcon aria-hidden /> Indent
        </ContextMenuPrimitive.Item>
      ) : null}
      {props.availability.outdent ? (
        <ContextMenuPrimitive.Item className={contextMenuItemClass} onClick={props.onOutdent}>
          <ArrowLineLeftIcon aria-hidden /> Outdent
        </ContextMenuPrimitive.Item>
      ) : null}
      <ContextMenuPrimitive.Item
        className={contextMenuItemClass}
        disabled={!props.availability.duplicate}
        onClick={props.onDuplicate}
      >
        <CopyIcon aria-hidden /> Duplicate
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />
      <ContextMenuPrimitive.Item className={contextMenuItemClass} onClick={props.onToggleLocked}>
        {props.state.locked ? <LockOpenIcon aria-hidden /> : <LockIcon aria-hidden />}
        {props.state.locked ? "Unlock canvas layer" : "Lock canvas layer"}
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Item className={contextMenuItemClass} onClick={props.onToggleHidden}>
        {props.state.hidden ? <EyeIcon aria-hidden /> : <EyeSlashIcon aria-hidden />}
        {props.state.hidden ? "Show on canvas" : "Hide on canvas"}
      </ContextMenuPrimitive.Item>
      <ContextMenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />
      <ContextMenuPrimitive.Item
        className={`${contextMenuItemClass} text-destructive focus:bg-destructive/10 focus:text-destructive`}
        disabled={!props.availability.delete}
        onClick={props.onDelete}
      >
        <TrashIcon aria-hidden /> Delete
      </ContextMenuPrimitive.Item>
    </>
  )
}

export function LayerContextMenuContent({
  actions,
  finalFocus,
}: {
  actions: LayerActionItemsProps
  finalFocus: boolean
}) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none" sideOffset={2}>
        <ContextMenuPrimitive.Popup
          className="bg-popover text-popover-foreground ring-foreground/10 z-50 w-52 min-w-32 rounded-lg p-1 shadow-md ring-1 outline-none"
          finalFocus={finalFocus}
        >
          <ContextLayerActionItems {...actions} />
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

export function visibleRows(
  document: MosaicDocument,
  expandedTreeNodes: ReadonlySet<string>,
  collapsedScreenIds: ReadonlySet<string>,
) {
  const rows: TreeRow[] = []

  function visitChildren(node: ProtocolNode, depth: number, progress: boolean) {
    if (node.type === "productSelector") {
      node.cards.forEach((card) => visit(card, depth, node.id, progress))
      return
    }
    if (
      node.type === "stack" ||
      node.type === "button" ||
      node.type === "productCard" ||
      node.type === "productBadge"
    ) {
      node.children.forEach((child) => visit(child, depth, node.id, progress))
      if (node.type === "button") {
        node.inProgressChildren?.forEach((child) => visit(child, depth, node.id, true))
      }
      return
    }
    if (node.type === "carousel") {
      node.pages.forEach((page) => visit(page.content, depth, node.id, progress))
    }
  }

  function visit(node: ProtocolNode, depth: number, parentId: string, progress = false) {
    rows.push({ kind: "component", id: node.id, depth, parentId, node, progress })
    if (expandedTreeNodes.has(node.id)) visitChildren(node, depth + 1, progress)
  }

  document.screens.forEach((screen) => {
    rows.push({
      kind: "scroll",
      id: screen.layout.id,
      screenId: screen.id,
      presentation: screen.presentation.type,
      depth: 1,
      parentId: null,
    })
    if (!collapsedScreenIds.has(screen.id)) {
      visit(screen.layout.content, 2, screen.layout.content.id)
    }
  })
  return rows
}

export function isRootContentId(document: MosaicDocument, id: string) {
  return document.screens.some((screen) => screen.layout.content.id === id)
}

export function isMarked(document: MosaicDocument, id: string, markedIds: ReadonlySet<string>) {
  return (
    markedIds.has(id) ||
    findAncestorNodeIds(document, id).some((ancestorId) => markedIds.has(ancestorId))
  )
}

export function actionDisabledReason(
  document: MosaicDocument,
  selectedComponentId: string | null,
  effectivelyLocked: boolean,
) {
  if (!selectedComponentId) return "Select a component first"
  if (isRootContentId(document, selectedComponentId)) return "The root content Stack is fixed"
  if (effectivelyLocked) return "Unlock this layer before changing its structure"
  return null
}
