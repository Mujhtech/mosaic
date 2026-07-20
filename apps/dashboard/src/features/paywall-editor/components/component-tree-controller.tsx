import type { DragEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react"
import { useLayoutEffect, useMemo, useRef, useState } from "react"

import {
  COMPONENT_CATALOG_BY_TYPE,
  COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE,
  COMPONENT_LIBRARY_DRAG_TYPE,
} from "@/features/paywall-editor/components/component-catalog"
import { useEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation"
import {
  useEditorActions,
  useEditorStoreSelector,
} from "@/features/paywall-editor/stores/editor-store-context"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  InsertableBlockType,
  PreviewClient,
  TreeInsertionLocation,
  TreeMoveTarget,
  TreeOperationResult,
} from "@/features/paywall-editor/types/editor"
import { isValidCountdownInstant } from "@/features/paywall-editor/utils/countdown"
import {
  appendScreen,
  findNode,
  findParent,
  getSiblingBoundaries,
  moveNode,
  parentEntryChildren,
  screenContainingNode,
} from "@/features/paywall-editor/utils/document-tree"
import type {
  CatalogDropPreview,
  DropPreview,
  LayerIssueSummary,
  OperationNotice,
  PointerLayerDrag,
  RowDropTarget,
  TreeRow,
} from "./component-tree-support"
import {
  actionDisabledReason,
  componentLabel,
  hasCatalogPayload,
  isMarked,
  isRootContentId,
  LAYER_DRAG_TYPE,
  rowLabel,
  selectLayerMetadata,
  selectTreeState,
  visibleRows,
} from "./component-tree-support"

export function useComponentTreeModel({
  previewClients,
}: {
  previewClients: readonly PreviewClient[]
}) {
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

  return {
    previewClients,
    document,
    expandedTreeNodes,
    hoveredComponentId,
    isDocumentTransactionActive,
    selectedComponentId,
    editor,
    layerMetadata,
    workspace,
    validation,
    collapsedScreenIds,
    setCollapsedScreenIds,
    rovingId,
    setRovingId,
    pendingRenameId,
    setPendingRenameId,
    renameId,
    setRenameId,
    renameDraft,
    setRenameDraft,
    dragSourceIdRef,
    dropPreview,
    setDropPreview,
    catalogDropPreview,
    setCatalogDropPreview,
    notice,
    setNotice,
    renameInputRef,
    rowRefs,
    pointerLayerDragRef,
    dropPreviewRef,
    suppressLayerClickRef,
    rows,
    rowIndexById,
    rowById,
    activeRovingId,
    lockedIds,
    hiddenIds,
    issueSummaries,
    activeDocument,
    selectedIsLocked,
    structuralReason,
    boundaries,
    canMoveUp,
    canMoveDown,
    canIndent,
    canOutdent,
    requiredCapabilities,
    focusRow,
    collapseScroll,
    expandScroll,
    toggleScroll,
    addDestination,
    reportOperation,
    beginRename,
    requestRename,
    finishMenuInteraction,
    commitRename,
    previewDrop,
    clearLayerDrag,
    dragOverTarget,
    dropOnTarget,
    catalogDropLocation,
    hasLayerPayload,
    layerDropTargetForRow,
    dragOverRow,
    dropOnRow,
    beginPointerLayerDrag,
    movePointerLayerDrag,
    finishPointerLayerDrag,
    cancelPointerLayerDrag,
    catalogDropBlock,
    dragCatalogOverRow,
    dropCatalogOnRow,
    handleTreeKeyDown,
  }
}

export type ComponentTreeModel = NonNullable<ReturnType<typeof useComponentTreeModel>>
