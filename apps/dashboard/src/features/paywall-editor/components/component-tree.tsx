import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown"
import { ArrowLineLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLineLeft"
import { ArrowLineRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowLineRight"
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp"
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight"
import { CopyIcon } from "@phosphor-icons/react/dist/ssr/Copy"
import { DevicesIcon } from "@phosphor-icons/react/dist/ssr/Devices"
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical"
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/ssr/DotsSixVertical"
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye"
import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr/EyeSlash"
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard"
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock"
import { LockOpenIcon } from "@phosphor-icons/react/dist/ssr/LockOpen"
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { XCircleIcon } from "@phosphor-icons/react/dist/ssr/XCircle"
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { StatusMessage } from "@mosaic/design-system"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { DragEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  COMPONENT_CATALOG_BY_TYPE,
  COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE,
  COMPONENT_LIBRARY_DRAG_TYPE,
  LAYER_TYPE_LABELS,
} from "@/features/paywall-editor/components/component-catalog"
import { LayerTypeIcon } from "@/features/paywall-editor/components/layer-type-icon"
import { STUDIO_LAYER_LABEL_MAX_LENGTH } from "@/features/paywall-editor/constants/studio-workspace"
import { useEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation"
import type { EditorState } from "@/features/paywall-editor/stores/editor-store"
import {
  useEditorActions,
  useEditorStoreSelector,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  MosaicDocument,
  InsertableBlockType,
  PreviewClient,
  ProtocolNode,
  RequiredCapability,
  TreeInsertionLocation,
  TreeMoveTarget,
  TreeOperationResult,
} from "@/features/paywall-editor/types/editor"
import {
  appendScreen,
  findAncestorNodeIds,
  findNode,
  findParent,
  getSiblingBoundaries,
  moveNode,
  parentEntryChildren,
  screenContainingNode,
} from "@/features/paywall-editor/utils/document-tree"

function hasCatalogPayload(event: DragEvent<HTMLDivElement>) {
  return (
    Array.from(event.dataTransfer.types ?? []).includes(COMPONENT_LIBRARY_DRAG_TYPE) ||
    Boolean(event.dataTransfer.getData(COMPONENT_LIBRARY_DRAG_TYPE))
  )
}
import { isValidCountdownInstant } from "@/features/paywall-editor/utils/countdown"

const LAYER_DRAG_TYPE = "application/x-mosaic-layer-id"

const CAPABILITY_BY_TYPE = {
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

const selectTreeState = (state: EditorState) => ({
  document: state.document,
  expandedTreeNodes: state.expandedTreeNodes,
  hoveredComponentId: state.hoveredComponentId,
  isDocumentTransactionActive: state.isDocumentTransactionActive,
  selectedComponentId: state.selectedComponentId,
})
const selectLayerMetadata = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.layerMetadata

type TreeRow =
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

interface DropPreview {
  readonly key: string
  readonly target: TreeMoveTarget
  readonly result: TreeOperationResult
}

interface RowDropTarget {
  readonly key: string
  readonly target: TreeMoveTarget
}

interface PointerLayerDrag {
  active: boolean
  readonly pointerId: number
  readonly sourceId: string
  readonly startX: number
  readonly startY: number
}

interface OperationNotice {
  readonly tone: "success" | "danger"
  readonly title: string
  readonly detail: string
}

interface CatalogDropPreview {
  readonly rowId: string
  readonly location: TreeInsertionLocation | null
  readonly blocked: boolean
  readonly label: string
}

interface LayerIssueSummary {
  errorCount: number
  warningCount: number
}

interface LayerActionItemsProps {
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

const EMPTY_LAYER_ISSUE_SUMMARY: LayerIssueSummary = { errorCount: 0, warningCount: 0 }

function supportsCapability(client: PreviewClient, requirement: RequiredCapability) {
  return client.supportedCapabilities.some(
    (capability) =>
      capability.name === requirement.name && capability.version === requirement.version,
  )
}

function validationStatusLabel(summary: LayerIssueSummary) {
  const errors = `${summary.errorCount} validation ${summary.errorCount === 1 ? "error" : "errors"}`
  if (summary.warningCount === 0) return errors
  return `${errors} and ${summary.warningCount} ${summary.warningCount === 1 ? "warning" : "warnings"}`
}

function rowLabel(row: TreeRow, labels: Readonly<Record<string, string>>) {
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

function defaultNodeLabel(node: ProtocolNode) {
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

function componentLabel(
  node: ProtocolNode,
  rootContentIds: ReadonlySet<string>,
  labels: Readonly<Record<string, string>>,
) {
  const customLabel = labels[node.id]?.trim()
  if (customLabel) return customLabel
  return rootContentIds.has(node.id) ? "Content Stack" : defaultNodeLabel(node)
}

function LayerActionItems({
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

const contextMenuItemClass =
  "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-none select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"

function ContextLayerActionItems(props: LayerActionItemsProps) {
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

function LayerContextMenuContent({
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

function visibleRows(
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

function isRootContentId(document: MosaicDocument, id: string) {
  return document.screens.some((screen) => screen.layout.content.id === id)
}

function isMarked(document: MosaicDocument, id: string, markedIds: ReadonlySet<string>) {
  return (
    markedIds.has(id) ||
    findAncestorNodeIds(document, id).some((ancestorId) => markedIds.has(ancestorId))
  )
}

function actionDisabledReason(
  document: MosaicDocument,
  selectedComponentId: string | null,
  effectivelyLocked: boolean,
) {
  if (!selectedComponentId) return "Select a component first"
  if (isRootContentId(document, selectedComponentId)) return "The root content Stack is fixed"
  if (effectivelyLocked) return "Unlock this layer before changing its structure"
  return null
}

// Tree interaction state must remain coordinated for roving focus, drag/drop, context menus, and
// layer transactions; leaf renderers and transformation rules are already extracted.
// oxlint-disable-next-line react-doctor/no-giant-component
export function ComponentTree({ previewClients }: { previewClients: readonly PreviewClient[] }) {
  const {
    document,
    expandedTreeNodes,
    hoveredComponentId,
    isDocumentTransactionActive,
    selectedComponentId,
  } = useEditorStoreSelector(selectTreeState)
  const editor = useEditorActions()
  const layerMetadata = useStudioWorkspaceSelector(selectLayerMetadata)
  const workspace = useStudioWorkspaceActions()
  const validation = useEditorValidation()
  const [collapsedScreenIds, setCollapsedScreenIds] = useState<ReadonlySet<string>>(() => new Set())
  const [rovingId, setRovingId] = useState<string | null>(null)
  const [pendingRenameId, setPendingRenameId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const dragSourceIdRef = useRef<string | null>(null)
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null)
  const [catalogDropPreview, setCatalogDropPreview] = useState<CatalogDropPreview | null>(null)
  const [notice, setNotice] = useState<OperationNotice | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const pointerLayerDragRef = useRef<PointerLayerDrag | null>(null)
  const dropPreviewRef = useRef<DropPreview | null>(null)
  const suppressLayerClickRef = useRef(false)
  const rows = useMemo(
    () => (document ? visibleRows(document, expandedTreeNodes, collapsedScreenIds) : []),
    [collapsedScreenIds, document, expandedTreeNodes],
  )
  const rowIndexById = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows])
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const activeRovingId =
    rovingId && rowIndexById.has(rovingId)
      ? rovingId
      : selectedComponentId && rowIndexById.has(selectedComponentId)
        ? selectedComponentId
        : document?.screens[0]?.layout.id
  const lockedIds = useMemo(() => new Set(layerMetadata.lockedIds), [layerMetadata.lockedIds])
  const hiddenIds = useMemo(
    () => new Set(layerMetadata.canvasHiddenIds),
    [layerMetadata.canvasHiddenIds],
  )
  const issueSummaries = useMemo(() => {
    const documentSummary: LayerIssueSummary = { errorCount: 0, warningCount: 0 }
    const byComponent = new Map<string, LayerIssueSummary>()
    validation.issues.forEach((issue) => {
      const key = issue.severity === "error" ? "errorCount" : "warningCount"
      documentSummary[key] += 1
      if (!issue.componentId) return
      const componentSummary = byComponent.get(issue.componentId) ?? {
        errorCount: 0,
        warningCount: 0,
      }
      componentSummary[key] += 1
      byComponent.set(issue.componentId, componentSummary)
    })
    return { byComponent, documentSummary }
  }, [validation.issues])

  useLayoutEffect(() => {
    if (!document) return
    const id = selectedComponentId ?? document.screens[0]?.layout.id
    if (!id) return
    rowRefs.current.get(id)?.scrollIntoView?.({ block: "nearest" })
  }, [document, expandedTreeNodes, selectedComponentId])

  useLayoutEffect(() => {
    if (!renameId) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renameId])

  if (!document) return null
  const activeDocument = document

  const selectedIsLocked = selectedComponentId
    ? isMarked(activeDocument, selectedComponentId, lockedIds)
    : false
  const structuralReason = actionDisabledReason(
    activeDocument,
    selectedComponentId,
    selectedIsLocked,
  )
  const boundaries = getSiblingBoundaries(activeDocument, selectedComponentId)
  const canMoveUp = structuralReason === null && boundaries?.canMovePrevious === true
  const canMoveDown = structuralReason === null && boundaries?.canMoveNext === true
  const canIndent = structuralReason === null && boundaries?.canIndentIntoPrevious === true
  const canOutdent = structuralReason === null && boundaries?.canOutdent === true
  const requiredCapabilities = new Map(
    activeDocument.compatibility.requiredCapabilities.map((capability) => [
      capability.name,
      capability,
    ]),
  )

  function focusRow(id: string) {
    setRovingId(id)
    rowRefs.current.get(id)?.focus()
  }

  function collapseScroll(screenId: string) {
    setCollapsedScreenIds((current) => new Set([...current, screenId]))
  }

  function expandScroll(screenId: string) {
    setCollapsedScreenIds((current) => {
      const next = new Set(current)
      next.delete(screenId)
      return next
    })
  }

  function toggleScroll(screenId: string) {
    if (collapsedScreenIds.has(screenId)) expandScroll(screenId)
    else collapseScroll(screenId)
  }

  function addDestination(presentation: "screen" | "sheet") {
    const sourceScreenId =
      screenContainingNode(activeDocument, selectedComponentId)?.id ??
      activeDocument.initialScreenId
    const result = appendScreen(activeDocument, { presentation, sourceScreenId })
    editor.updateDocument(() => result.document)
    editor.selectComponent(result.selectionId)
    expandScroll(result.screenId)
    setNotice({
      tone: "success",
      title: `${presentation === "sheet" ? "Sheet" : "Screen"} added`,
      detail: "A navigation Button was added to the focused source frame.",
    })
  }

  function reportOperation(result: TreeOperationResult, success: string) {
    if (result.status === "accepted") {
      setNotice({ tone: "success", title: success, detail: "The change can be undone." })
      return
    }
    setNotice({
      tone: "danger",
      title: result.message,
      detail: result.recovery,
    })
  }

  function beginRename(id: string) {
    const node = findNode(activeDocument, id)
    if (!node) return
    setRenameId(id)
    setRenameDraft(
      layerMetadata.labels[id] ??
        componentLabel(
          node,
          new Set(activeDocument.screens.map((screen) => screen.layout.content.id)),
          {},
        ),
    )
  }

  function requestRename(id: string) {
    setPendingRenameId(id)
  }

  function finishMenuInteraction(open: boolean) {
    if (open || !pendingRenameId) return
    setPendingRenameId(null)
    beginRename(pendingRenameId)
  }

  function commitRename() {
    if (!renameId) return
    const nextLabel = renameDraft.trim()
    if (nextLabel) workspace.setLayerLabel(renameId, nextLabel)
    else workspace.removeLayerLabel(renameId)
    setRenameId(null)
  }

  function previewDrop(key: string, sourceId: string, target: TreeMoveTarget) {
    const result = moveNode(activeDocument, sourceId, target)
    const preview = { key, target, result }
    dropPreviewRef.current = preview
    setDropPreview(preview)
    return result
  }

  function clearLayerDrag() {
    pointerLayerDragRef.current = null
    dropPreviewRef.current = null
    dragSourceIdRef.current = null
    setDropPreview(null)
  }

  function dragOverTarget(event: DragEvent<HTMLDivElement>, key: string, target: TreeMoveTarget) {
    const sourceId = dragSourceIdRef.current || event.dataTransfer.getData(LAYER_DRAG_TYPE)
    if (!sourceId) return
    event.preventDefault()
    const result = previewDrop(key, sourceId, target)
    event.dataTransfer.dropEffect = result.status === "accepted" ? "move" : "none"
  }

  function dropOnTarget(event: DragEvent<HTMLDivElement>, key: string, target: TreeMoveTarget) {
    const sourceId = dragSourceIdRef.current || event.dataTransfer.getData(LAYER_DRAG_TYPE)
    if (!sourceId) return
    event.preventDefault()
    const preview =
      dropPreview?.key === key ? dropPreview.result : previewDrop(key, sourceId, target)
    if (preview.status === "rejected") {
      reportOperation(preview, "")
    } else {
      reportOperation(editor.moveComponent(sourceId, target), "Layer moved")
    }
    clearLayerDrag()
  }

  function catalogDropLocation(row: TreeRow): TreeInsertionLocation | null {
    if (row.kind === "scroll") return null
    if (
      row.node.type === "stack" ||
      row.node.type === "button" ||
      row.node.type === "productCard" ||
      row.node.type === "productBadge"
    ) {
      return { parentId: row.id, index: row.node.children.length }
    }
    const parent = findParent(activeDocument, row.id)
    return parent ? { parentId: parent.parent.id, index: parent.index + 1 } : null
  }

  function hasLayerPayload(event: DragEvent<HTMLDivElement>) {
    return (
      Boolean(dragSourceIdRef.current) ||
      Array.from(event.dataTransfer.types ?? []).includes(LAYER_DRAG_TYPE) ||
      Boolean(event.dataTransfer.getData(LAYER_DRAG_TYPE))
    )
  }

  function layerDropTargetForRow(
    clientY: number,
    row: TreeRow,
    element: HTMLElement,
  ): RowDropTarget | null {
    if (row.kind !== "component") return null

    const sourceParent = findParent(activeDocument, row.id)
    if (!sourceParent && row.node.type === "stack") {
      return {
        key: `${row.id}:inside`,
        target: {
          placement: "inside",
          targetId: row.id,
          index: row.node.children.length,
        },
      }
    }

    const bounds = element.getBoundingClientRect()
    const position = bounds.height > 0 ? (clientY - bounds.top) / bounds.height : 0
    if (
      (row.node.type === "stack" ||
        row.node.type === "button" ||
        row.node.type === "productSelector" ||
        row.node.type === "productCard" ||
        row.node.type === "productBadge") &&
      position >= 0.25 &&
      position <= 0.75
    ) {
      const index =
        row.node.type === "productSelector" ? row.node.cards.length : row.node.children.length
      return {
        key: `${row.id}:inside`,
        target: {
          placement: "inside",
          targetId: row.id,
          index,
        },
      }
    }

    const placement = position > 0.5 ? "after" : "before"
    return {
      key: `${row.id}:${placement}`,
      target: { placement, targetId: row.id },
    }
  }

  function dragOverRow(event: DragEvent<HTMLDivElement>, row: TreeRow) {
    if (hasCatalogPayload(event)) {
      dragCatalogOverRow(event, row)
      return
    }
    if (!hasLayerPayload(event)) return
    const target = layerDropTargetForRow(event.clientY, row, event.currentTarget)
    if (!target) return
    dragOverTarget(event, target.key, target.target)
  }

  function dropOnRow(event: DragEvent<HTMLDivElement>, row: TreeRow) {
    if (hasCatalogPayload(event)) {
      dropCatalogOnRow(event, row)
      return
    }
    if (!hasLayerPayload(event)) return
    const target = layerDropTargetForRow(event.clientY, row, event.currentTarget)
    if (!target) return
    dropOnTarget(event, target.key, target.target)
  }

  function beginPointerLayerDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    row: TreeRow,
    draggable: boolean,
  ) {
    const origin = event.target
    const startedFromControl =
      origin instanceof Element && origin.closest("button, input, [role='menuitem']") !== null
    if (!draggable || event.button !== 0 || startedFromControl) return
    pointerLayerDragRef.current = {
      active: false,
      pointerId: event.pointerId,
      sourceId: row.id,
      startX: event.clientX,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function movePointerLayerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerLayerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
      if (distance < 5) return
      drag.active = true
      dragSourceIdRef.current = drag.sourceId
      setNotice(null)
    }

    event.preventDefault()
    const hit = globalThis.document.elementFromPoint(event.clientX, event.clientY)
    const targetElement = hit?.closest<HTMLElement>("[data-layer-row-id]") ?? null
    const targetRow = targetElement ? rowById.get(targetElement.dataset.layerRowId ?? "") : null
    if (!targetElement || !targetRow) {
      dropPreviewRef.current = null
      setDropPreview(null)
      return
    }
    const target = layerDropTargetForRow(event.clientY, targetRow, targetElement)
    if (!target) {
      dropPreviewRef.current = null
      setDropPreview(null)
      return
    }
    previewDrop(target.key, drag.sourceId, target.target)
  }

  function finishPointerLayerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerLayerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (!drag.active) {
      pointerLayerDragRef.current = null
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const preview = dropPreviewRef.current
    if (preview?.result.status === "accepted") {
      reportOperation(editor.moveComponent(drag.sourceId, preview.target), "Layer moved")
    } else if (preview?.result.status === "rejected") {
      reportOperation(preview.result, "")
    }
    suppressLayerClickRef.current = true
    globalThis.setTimeout(() => {
      suppressLayerClickRef.current = false
    }, 0)
    clearLayerDrag()
  }

  function cancelPointerLayerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerLayerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    clearLayerDrag()
  }

  function catalogDropBlock(
    row: TreeRow,
    type: string,
    countdownEndsAt: string,
    validatePayload: boolean,
  ): { title: string; detail: string } | null {
    const location = catalogDropLocation(row)
    if (!location) {
      return {
        title: "Scroll Container is not an insertion target.",
        detail: "Drop inside Content Stack or after a visible content layer.",
      }
    }
    if (isDocumentTransactionActive) {
      return {
        title: "Finish the current edit first.",
        detail: "Commit or cancel the active text or property edit, then drop the component.",
      }
    }
    if (isMarked(activeDocument, location.parentId, lockedIds)) {
      return {
        title: "The insertion Stack is locked.",
        detail: "Unlock the destination Stack in Layers, then try the drop again.",
      }
    }
    if (validatePayload && !COMPONENT_CATALOG_BY_TYPE.has(type as InsertableBlockType)) {
      return {
        title: "That component type is not supported.",
        detail: "Drag a Protocol 0.2 component from Add content.",
      }
    }
    if (validatePayload && type === "countdown" && !isValidCountdownInstant(countdownEndsAt)) {
      return {
        title: "Countdown needs an explicit valid UTC deadline.",
        detail: "Return to Add content, enter the deadline, and drag again.",
      }
    }
    return null
  }

  function dragCatalogOverRow(event: DragEvent<HTMLDivElement>, row: TreeRow) {
    if (!hasCatalogPayload(event)) return
    event.preventDefault()
    event.stopPropagation()
    const type = event.dataTransfer.getData(COMPONENT_LIBRARY_DRAG_TYPE)
    const countdownEndsAt = event.dataTransfer.getData(
      COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE,
    )
    const location = catalogDropLocation(row)
    const block = catalogDropBlock(row, type, countdownEndsAt, false)
    const targetLabel =
      row.kind === "scroll" ? "Scroll Container" : rowLabel(row, layerMetadata.labels)
    setCatalogDropPreview({
      rowId: row.id,
      location,
      blocked: Boolean(block),
      label:
        row.kind === "component" &&
        (row.node.type === "stack" ||
          row.node.type === "button" ||
          row.node.type === "productCard" ||
          row.node.type === "productBadge")
          ? `Drop inside ${targetLabel}`
          : `Drop after ${targetLabel}`,
    })
    event.dataTransfer.dropEffect = block ? "none" : "copy"
    if (block) setNotice({ tone: "danger", title: block.title, detail: block.detail })
  }

  function dropCatalogOnRow(event: DragEvent<HTMLDivElement>, row: TreeRow) {
    if (!hasCatalogPayload(event)) return
    event.preventDefault()
    event.stopPropagation()
    const rawType = event.dataTransfer.getData(COMPONENT_LIBRARY_DRAG_TYPE)
    const countdownEndsAt = event.dataTransfer.getData(
      COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE,
    )
    const block = catalogDropBlock(row, rawType, countdownEndsAt, true)
    const location = catalogDropLocation(row)
    if (block || !location || !COMPONENT_CATALOG_BY_TYPE.has(rawType as InsertableBlockType)) {
      const failure = block ?? {
        title: "That component type is not supported.",
        detail: "Drag a Protocol 0.2 component from Add content.",
      }
      setNotice({ tone: "danger", title: failure.title, detail: failure.detail })
      setCatalogDropPreview(null)
      return
    }

    const type = rawType as InsertableBlockType
    const label = COMPONENT_CATALOG_BY_TYPE.get(type)?.label ?? type
    const result = editor.insertComponentAt(
      type,
      location,
      type === "countdown" ? { countdownEndsAt } : undefined,
    )
    reportOperation(result, `${label} inserted`)
    if (result.status === "accepted") workspace.recordRecentInsertion(type)
    setCatalogDropPreview(null)
  }

  function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>, row: TreeRow) {
    if (event.target !== event.currentTarget) return
    const rowIndex = rowIndexById.get(row.id) ?? 0
    const next = rows[rowIndex + 1]
    const previous = rows[rowIndex - 1]
    const component = row.kind === "component" ? row.node : null
    const expandable =
      row.kind === "scroll" ||
      component?.type === "stack" ||
      component?.type === "button" ||
      component?.type === "carousel" ||
      component?.type === "productSelector" ||
      component?.type === "productCard" ||
      component?.type === "productBadge"
    const expanded =
      row.kind === "scroll" ? !collapsedScreenIds.has(row.screenId) : expandedTreeNodes.has(row.id)
    const rowLocked = row.kind === "component" && isMarked(activeDocument, row.id, lockedIds)
    const rowParent = row.kind === "component" ? findParent(activeDocument, row.id) : null
    const rowImmutable = row.kind === "scroll" || !rowParent

    if (event.altKey && row.kind === "component" && selectedComponentId === row.id) {
      if (event.key === "ArrowUp" && canMoveUp) {
        reportOperation(editor.moveSelectedComponent(-1), "Layer moved up")
      } else if (event.key === "ArrowDown" && canMoveDown) {
        reportOperation(editor.moveSelectedComponent(1), "Layer moved down")
      } else if (event.key === "ArrowRight" && canIndent) {
        reportOperation(editor.indentSelectedComponent(), "Layer indented")
      } else if (event.key === "ArrowLeft" && canOutdent) {
        reportOperation(editor.outdentSelectedComponent(), "Layer outdented")
      } else {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault()
      event.stopPropagation()
      if (row.kind === "component" && !rowImmutable && !rowLocked) {
        editor.selectComponent(row.id)
        reportOperation(editor.duplicateSelectedComponent(), "Layer duplicated")
      }
      return
    }
    if ((event.key === "Delete" || event.key === "Backspace") && row.kind === "component") {
      event.preventDefault()
      event.stopPropagation()
      if (
        !rowImmutable &&
        !rowLocked &&
        rowParent &&
        (rowParent.collection === "inProgressChildren" ||
          (!isRootContentId(activeDocument, rowParent.parent.id) &&
            rowParent.parent.type !== "button") ||
          parentEntryChildren(rowParent).length > 1)
      ) {
        editor.selectComponent(row.id)
        reportOperation(editor.deleteSelectedComponent(), "Layer deleted")
      }
      return
    }

    switch (event.key) {
      case "ArrowDown":
        if (next) focusRow(next.id)
        break
      case "ArrowUp":
        if (previous) focusRow(previous.id)
        break
      case "Home":
        if (rows[0]) focusRow(rows[0].id)
        break
      case "End":
        if (rows.at(-1)) focusRow(rows.at(-1)!.id)
        break
      case "ArrowRight":
        if (expandable && !expanded) {
          if (row.kind === "scroll") expandScroll(row.screenId)
          else editor.toggleTreeNode(row.id)
        } else if (next && next.depth > row.depth) {
          focusRow(next.id)
        } else {
          return
        }
        break
      case "ArrowLeft":
        if (expandable && expanded) {
          if (row.kind === "scroll") collapseScroll(row.screenId)
          else editor.toggleTreeNode(row.id)
        } else if (row.kind === "component") {
          focusRow(row.parentId)
        } else {
          return
        }
        break
      case "Enter":
      case " ":
        editor.selectComponent(row.id)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <section aria-labelledby="component-tree-title">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold" id="component-tree-title">
            Layers
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Drag anywhere on a layer row to reorder.
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label="Add screen or sheet"
                  size="icon-sm"
                  title="Add screen or sheet"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <PlusIcon aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => addDestination("screen")}>
                <DevicesIcon aria-hidden /> Add screen
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addDestination("sheet")}>
                <StackIcon aria-hidden /> Add sheet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Layer shortcuts"
                  size="icon-sm"
                  title="Layer shortcuts"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <KeyboardIcon aria-hidden />
            </TooltipTrigger>
            <TooltipContent align="end" className="block w-64 p-3" side="bottom">
              <p className="font-medium">Layer shortcuts</p>
              <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] leading-4">
                <kbd data-slot="kbd">↑ ↓</kbd>
                <span>Navigate</span>
                <kbd data-slot="kbd">Alt + ↑ ↓</kbd>
                <span>Move</span>
                <kbd data-slot="kbd">Alt + → ←</kbd>
                <span>Nest or outdent</span>
                <kbd data-slot="kbd">⌘/Ctrl + D</kbd>
                <span>Duplicate</span>
                <kbd data-slot="kbd">Delete</kbd>
                <span>Delete layer</span>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {notice ? (
        <StatusMessage
          className={`mb-3 rounded-lg border p-2 text-xs ${
            notice.tone === "danger"
              ? "border-destructive/25 bg-destructive/5"
              : "border-primary/20 bg-primary/5"
          }`}
          tone={notice.tone}
        >
          <p className="font-medium">{notice.title}</p>
          <p className="text-muted-foreground mt-0.5">{notice.detail}</p>
        </StatusMessage>
      ) : null}

      <div aria-label="Paywall component tree" className="space-y-0.5" role="tree">
        {rows.map((row) => {
          const isScroll = row.kind === "scroll"
          const node = row.kind === "component" ? row.node : null
          const isStack = node?.type === "stack"
          const isButton = node?.type === "button"
          const isCarousel = node?.type === "carousel"
          const isProductContainer =
            node?.type === "productSelector" ||
            node?.type === "productCard" ||
            node?.type === "productBadge"
          const expandable = isScroll || isStack || isButton || isCarousel || isProductContainer
          const expanded = isScroll
            ? !collapsedScreenIds.has(row.screenId)
            : isStack || isButton || isCarousel || isProductContainer
              ? expandedTreeNodes.has(row.id)
              : undefined
          const selected = selectedComponentId === row.id
          const hovered = !isScroll && hoveredComponentId === row.id
          const directlyLocked = lockedIds.has(row.id)
          const effectivelyLocked = !isScroll && isMarked(document, row.id, lockedIds)
          const directlyHidden = hiddenIds.has(row.id)
          const effectivelyHidden = !isScroll && isMarked(document, row.id, hiddenIds)
          const issueSummary = isScroll
            ? issueSummaries.documentSummary
            : (issueSummaries.byComponent.get(row.id) ?? EMPTY_LAYER_ISSUE_SUMMARY)
          const capability = isScroll
            ? CAPABILITY_BY_TYPE.scrollContainer
            : node
              ? CAPABILITY_BY_TYPE[node.type]
              : undefined
          const capabilityRequirement = capability
            ? requiredCapabilities.get(capability)
            : undefined
          const incompatibleClientCount = capabilityRequirement
            ? previewClients.filter((client) => !supportsCapability(client, capabilityRequirement))
                .length
            : 0
          const label = rowLabel(row, layerMetadata.labels)
          const sourceParent = node ? findParent(activeDocument, row.id) : null
          const immutable = isScroll || !sourceParent
          const draggable = !immutable && !effectivelyLocked
          const rowBoundaries = node ? getSiblingBoundaries(activeDocument, row.id) : null
          const sourceRequiresChild =
            sourceParent?.collection !== "inProgressChildren" &&
            (Boolean(sourceParent && isRootContentId(activeDocument, sourceParent.parent.id)) ||
              sourceParent?.parent.type === "button" ||
              sourceParent?.parent.type === "productSelector" ||
              sourceParent?.parent.type === "productCard" ||
              sourceParent?.parent.type === "productBadge")
          const rowCanDelete =
            !immutable &&
            !effectivelyLocked &&
            Boolean(sourceParent) &&
            (!sourceRequiresChild || parentEntryChildren(sourceParent!).length > 1)
          const rowCanIndent =
            !immutable && !effectivelyLocked && rowBoundaries?.canIndentIntoPrevious === true
          const rowCanOutdent =
            !immutable && !effectivelyLocked && rowBoundaries?.canOutdent === true
          const layerActions: LayerActionItemsProps | null = node
            ? {
                availability: {
                  delete: rowCanDelete,
                  duplicate: !immutable && !effectivelyLocked && node.type !== "productBadge",
                  indent: rowCanIndent,
                  moveDown: !immutable && !effectivelyLocked && rowBoundaries?.canMoveNext === true,
                  moveUp:
                    !immutable && !effectivelyLocked && rowBoundaries?.canMovePrevious === true,
                  outdent: rowCanOutdent,
                },
                state: { hidden: directlyHidden, locked: directlyLocked },
                onDelete: () => {
                  editor.selectComponent(row.id)
                  reportOperation(editor.deleteSelectedComponent(), "Layer deleted")
                },
                onDuplicate: () => {
                  editor.selectComponent(row.id)
                  reportOperation(editor.duplicateSelectedComponent(), "Layer duplicated")
                },
                onIndent: () => {
                  editor.selectComponent(row.id)
                  reportOperation(editor.indentSelectedComponent(), "Layer indented")
                },
                onMoveDown: () => {
                  editor.selectComponent(row.id)
                  reportOperation(editor.moveSelectedComponent(1), "Layer moved down")
                },
                onMoveUp: () => {
                  editor.selectComponent(row.id)
                  reportOperation(editor.moveSelectedComponent(-1), "Layer moved up")
                },
                onOutdent: () => {
                  editor.selectComponent(row.id)
                  reportOperation(editor.outdentSelectedComponent(), "Layer outdented")
                },
                onRename: () => {
                  editor.selectComponent(row.id)
                  requestRename(row.id)
                },
                onToggleHidden: () => workspace.toggleLayerCanvasHidden(row.id),
                onToggleLocked: () => workspace.toggleLayerLocked(row.id),
              }
            : null
          const beforeKey = `${row.id}:before`
          const afterKey = `${row.id}:after`
          const insideKey = `${row.id}:inside`
          const activeRowDrop =
            dropPreview?.key === beforeKey ||
            dropPreview?.key === afterKey ||
            dropPreview?.key === insideKey

          return (
            <div key={row.id}>
              <ContextMenuPrimitive.Root
                disabled={!node}
                onOpenChange={(open) => {
                  if (!open || !node) return
                  setRovingId(row.id)
                  editor.selectComponent(row.id)
                }}
                onOpenChangeComplete={finishMenuInteraction}
              >
                <ContextMenuPrimitive.Trigger
                  aria-expanded={expandable ? expanded : undefined}
                  aria-level={row.depth}
                  aria-selected={selected}
                  className={`focus-visible:ring-ring group relative flex min-h-9 items-center gap-1 rounded-md border pr-1 text-sm outline-none focus-visible:ring-2 ${
                    activeRowDrop
                      ? dropPreview.result.status === "accepted"
                        ? "border-primary/50 bg-primary/10 ring-primary/30 ring-1"
                        : "border-destructive/50 bg-destructive/5 ring-destructive/30 ring-1"
                      : "border-transparent"
                  } ${
                    selected
                      ? "bg-primary/10 text-primary border-primary/15"
                      : hovered
                        ? "bg-muted border-border"
                        : "hover:bg-muted/70"
                  } ${effectivelyHidden ? "text-muted-foreground opacity-65" : ""} ${draggable ? "cursor-grab touch-none select-none active:cursor-grabbing" : ""}`}
                  data-layer-row-id={row.id}
                  draggable={draggable}
                  data-drop-placement={activeRowDrop ? dropPreview?.target.placement : undefined}
                  onClick={(event) => {
                    if (suppressLayerClickRef.current) {
                      event.preventDefault()
                      event.stopPropagation()
                      suppressLayerClickRef.current = false
                      return
                    }
                    focusRow(row.id)
                    editor.selectComponent(row.id)
                  }}
                  onDragEnd={() => {
                    clearLayerDrag()
                    setCatalogDropPreview(null)
                  }}
                  onDragLeave={(event) => {
                    if (
                      event.relatedTarget instanceof Node &&
                      event.currentTarget.contains(event.relatedTarget)
                    ) {
                      return
                    }
                    if (catalogDropPreview?.rowId === row.id) setCatalogDropPreview(null)
                  }}
                  onDragOver={(event) => dragOverRow(event, row)}
                  onDragStart={(event) => {
                    if (pointerLayerDragRef.current) {
                      event.preventDefault()
                      return
                    }
                    const origin = event.target
                    const startedFromControl =
                      origin instanceof Element && origin.closest("button, input") !== null
                    if (!draggable || startedFromControl) {
                      event.preventDefault()
                      return
                    }
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData(LAYER_DRAG_TYPE, row.id)
                    event.dataTransfer.setData("text/plain", row.id)
                    dragSourceIdRef.current = row.id
                    setDropPreview(null)
                    setNotice(null)
                  }}
                  onDrop={(event) => dropOnRow(event, row)}
                  onKeyDown={(event) => handleTreeKeyDown(event, row)}
                  onMouseEnter={() => {
                    if (!isScroll) editor.hoverComponent(row.id)
                  }}
                  onMouseLeave={() => {
                    if (!isScroll) editor.hoverComponent(null)
                  }}
                  onPointerCancel={cancelPointerLayerDrag}
                  onPointerDown={(event) => beginPointerLayerDrag(event, row, draggable)}
                  onPointerMove={movePointerLayerDrag}
                  onPointerUp={finishPointerLayerDrag}
                  ref={(element) => {
                    if (element) rowRefs.current.set(row.id, element)
                    else rowRefs.current.delete(row.id)
                  }}
                  role="treeitem"
                  style={{ paddingInlineStart: `${4 + (row.depth - 1) * 14}px` }}
                  tabIndex={activeRovingId === row.id ? 0 : -1}
                  title={
                    effectivelyLocked
                      ? `${label} is locked from canvas selection and structural controls`
                      : effectivelyHidden
                        ? `${label} is hidden on the canvas only`
                        : label
                  }
                >
                  {draggable ? (
                    <span
                      aria-label={`Drag ${label} to reorder`}
                      className="text-muted-foreground grid size-4 shrink-0 place-items-center opacity-45 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      data-slot="layer-reorder-affordance"
                      title={`Drag ${label} to reorder`}
                    >
                      <DotsSixVerticalIcon aria-hidden className="size-4" weight="bold" />
                    </span>
                  ) : (
                    <span aria-hidden className="size-4 shrink-0" />
                  )}
                  {expandable ? (
                    <button
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
                      className="focus-visible:ring-ring grid size-6 shrink-0 place-items-center rounded focus-visible:ring-2 focus-visible:outline-none"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (isScroll) toggleScroll(row.screenId)
                        else editor.toggleTreeNode(row.id)
                      }}
                      type="button"
                    >
                      {expanded ? <CaretDownIcon aria-hidden /> : <CaretRightIcon aria-hidden />}
                    </button>
                  ) : (
                    <span className="size-6 shrink-0" aria-hidden />
                  )}
                  <span className="text-muted-foreground grid size-5 shrink-0 place-items-center">
                    <LayerTypeIcon type={isScroll ? "scrollContainer" : node!.type} />
                  </span>
                  {renameId === row.id && node ? (
                    <input
                      aria-label={`Rename ${label}`}
                      className="border-input bg-background focus-visible:ring-ring min-w-0 flex-1 rounded border px-1.5 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
                      maxLength={STUDIO_LAYER_LABEL_MAX_LENGTH}
                      onBlur={commitRename}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename()
                        if (event.key === "Escape") setRenameId(null)
                        event.stopPropagation()
                      }}
                      ref={renameInputRef}
                      value={renameDraft}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                  )}
                  {effectivelyHidden ? (
                    <EyeSlashIcon
                      aria-label="Hidden on canvas"
                      className="text-muted-foreground shrink-0"
                    />
                  ) : null}
                  {effectivelyLocked ? (
                    <LockIcon aria-label="Locked" className="text-muted-foreground shrink-0" />
                  ) : null}
                  {issueSummary.errorCount > 0 ? (
                    <XCircleIcon
                      aria-label={validationStatusLabel(issueSummary)}
                      className="text-destructive shrink-0"
                      data-slot="layer-status"
                    />
                  ) : issueSummary.warningCount > 0 ? (
                    <WarningCircleIcon
                      aria-label={`${issueSummary.warningCount} validation ${issueSummary.warningCount === 1 ? "warning" : "warnings"}`}
                      className="shrink-0 text-amber-600"
                      data-slot="layer-status"
                    />
                  ) : incompatibleClientCount > 0 && capabilityRequirement ? (
                    <DevicesIcon
                      aria-label={`${capabilityRequirement.name} support differs on ${incompatibleClientCount} connected ${incompatibleClientCount === 1 ? "preview" : "previews"}`}
                      className="shrink-0 text-amber-600"
                      data-slot="layer-status"
                    />
                  ) : null}
                  {node && layerActions ? (
                    <DropdownMenu onOpenChangeComplete={finishMenuInteraction}>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label={`Actions for ${label}`}
                            onClick={(event) => event.stopPropagation()}
                            size="icon-sm"
                            title={`Actions for ${label}`}
                            type="button"
                            variant="ghost"
                          />
                        }
                      >
                        <DotsThreeVerticalIcon aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-52"
                        finalFocus={pendingRenameId ? false : true}
                      >
                        <LayerActionItems {...layerActions} />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </ContextMenuPrimitive.Trigger>
                {node && layerActions ? (
                  <LayerContextMenuContent
                    actions={layerActions}
                    finalFocus={pendingRenameId ? false : true}
                  />
                ) : null}
              </ContextMenuPrimitive.Root>
              {catalogDropPreview?.rowId === row.id ? (
                <div
                  aria-live="polite"
                  className={`my-1 rounded border px-2 py-1 text-[10px] font-medium ${
                    catalogDropPreview.blocked
                      ? "border-destructive/40 bg-destructive/5 text-destructive"
                      : "border-primary/40 bg-primary/5 text-primary"
                  }`}
                >
                  {catalogDropPreview.blocked
                    ? "This layer cannot accept that component"
                    : catalogDropPreview.label}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
