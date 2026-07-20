import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { StatusMessage } from "@mosaic/design-system"
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight"
import { DevicesIcon } from "@phosphor-icons/react/dist/ssr/Devices"
import { DotsSixVerticalIcon } from "@phosphor-icons/react/dist/ssr/DotsSixVertical"
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical"
import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr/EyeSlash"
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard"
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus"
import { StackIcon } from "@phosphor-icons/react/dist/ssr/Stack"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { XCircleIcon } from "@phosphor-icons/react/dist/ssr/XCircle"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LayerTypeIcon } from "@/features/paywall-editor/components/layer-type-icon"
import { STUDIO_LAYER_LABEL_MAX_LENGTH } from "@/features/paywall-editor/constants/studio-workspace"
import {
  findParent,
  getSiblingBoundaries,
  parentEntryChildren,
} from "@/features/paywall-editor/utils/document-tree"
import type { LayerActionItemsProps } from "./component-tree-support"
import {
  CAPABILITY_BY_TYPE,
  EMPTY_LAYER_ISSUE_SUMMARY,
  isMarked,
  isRootContentId,
  LAYER_DRAG_TYPE,
  LayerActionItems,
  LayerContextMenuContent,
  rowLabel,
  supportsCapability,
  validationStatusLabel,
} from "./component-tree-support"

import type { ComponentTreeModel } from "./component-tree-controller"

export function ComponentTreeView({ model }: { model: ComponentTreeModel }) {
  const {
    previewClients,
    document,
    expandedTreeNodes,
    hoveredComponentId,
    selectedComponentId,
    editor,
    layerMetadata,
    workspace,
    collapsedScreenIds,
    setRovingId,
    pendingRenameId,
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
    suppressLayerClickRef,
    rows,
    activeRovingId,
    lockedIds,
    hiddenIds,
    issueSummaries,
    activeDocument,
    requiredCapabilities,
    focusRow,
    toggleScroll,
    addDestination,
    reportOperation,
    requestRename,
    finishMenuInteraction,
    commitRename,
    clearLayerDrag,
    dragOverRow,
    dropOnRow,
    beginPointerLayerDrag,
    movePointerLayerDrag,
    finishPointerLayerDrag,
    cancelPointerLayerDrag,
    handleTreeKeyDown,
  } = model
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
