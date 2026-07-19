import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { DragEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react"

import { CanvasPreviewDevice } from "@/features/paywall-editor/components/canvas-preview-device"
import {
  resolveCanvasDeviceGeometry,
  resolveCanvasDeviceNodeGeometry,
  type CanvasDeviceGeometry,
  type CanvasDeviceNodeGeometry,
} from "@/features/paywall-editor/components/canvas-preview-geometry"
import {
  PreviewNode,
  type PreviewNodeProps,
} from "@/features/paywall-editor/components/canvas-preview-node"
import {
  COMPONENT_CATALOG_BY_TYPE,
  COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE,
  COMPONENT_LIBRARY_DRAG_TYPE,
} from "@/features/paywall-editor/components/component-catalog"
import { CanvasPreviewToolbar } from "@/features/paywall-editor/components/preview-controls"
import {
  getCanvasDevicePreset,
  type CanvasDevicePreset,
} from "@/features/paywall-editor/constants/canvas-devices"
import {
  STUDIO_CANVAS_FRAME_POSITION_BOUNDS,
  STUDIO_CANVAS_ZOOM_BOUNDS,
} from "@/features/paywall-editor/constants/studio-workspace"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  InsertableBlockType,
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
  ProtocolNode,
  Screen,
} from "@/features/paywall-editor/types/editor"
import type {
  StudioCanvasFramePosition,
  StudioCanvasPreferences,
} from "@/features/paywall-editor/types/studio-workspace"
import {
  canvasNodeIsUnavailable,
  getEditableCanvasText,
} from "@/features/paywall-editor/utils/canvas-preview-interactions"
import {
  flattenDocument,
  initialScreen,
  resolveLegacyInsertionLocation,
  screenContainingNode,
} from "@/features/paywall-editor/utils/document-tree"
import { isValidCountdownInstant } from "@/features/paywall-editor/utils/countdown"
import { updateLocalizedProperty } from "@/features/paywall-editor/utils/editor-transforms"
import {
  evaluateVisibility,
  paywallRuntimeDiagnostics,
  runtimeStateForAcceptedRevision,
} from "@/lib/mosaic-protocol"

const DEVICE_NODE_ID = "studio-device-preview"
const selectCanvasPreferences = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.canvas
const selectFramePositions = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.framePositions
const selectLayerMetadata = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.layerMetadata

interface CanvasNotice {
  readonly message: string
  readonly tone: "ready" | "danger" | "success"
}

interface PreviewRuntimeState {
  readonly document: MosaicDocument | null
  readonly switchValues: Readonly<Record<string, boolean>>
  readonly carouselPages: Readonly<Record<string, number>>
  readonly selectedProducts: Readonly<Record<string, string>>
}

interface TransientFramePositions {
  readonly workspaceBase: Readonly<Record<string, StudioCanvasFramePosition>>
  readonly positions: Readonly<Record<string, StudioCanvasFramePosition>>
}

function previewRuntimeState(document: MosaicDocument | null): PreviewRuntimeState {
  if (!document) {
    return { document, switchValues: {}, carouselPages: {}, selectedProducts: {} }
  }
  const runtime = runtimeStateForAcceptedRevision(document)
  return {
    document,
    switchValues: runtime.switches,
    carouselPages: runtime.carousels,
    selectedProducts: runtime.selectedProducts,
  }
}

interface CanvasDeviceNodeData extends Record<string, unknown> {
  readonly active: boolean
  readonly canvas: StudioCanvasPreferences
  readonly children: ReactNode
  readonly direction: "ltr" | "rtl"
  readonly document: MosaicDocument
  readonly geometry: CanvasDeviceGeometry
  readonly initial: boolean
  readonly layout: Screen["layout"]
  readonly nodeGeometry: CanvasDeviceNodeGeometry
  readonly onFrameSelect: () => void
  readonly onRootClick: (event: ReactMouseEvent<HTMLDivElement>) => void
  readonly onRootSelect: () => void
  readonly presentation: "screen" | "sheet"
  readonly preset: CanvasDevicePreset
  readonly rootHidden: boolean
  readonly screenLabel: string
  readonly selectedComponentId: string | null
}

type CanvasDeviceFlowNode = Node<CanvasDeviceNodeData, "device-preview">

const DevicePreviewFlowNode = memo(function DevicePreviewFlowNode({
  data,
}: NodeProps<CanvasDeviceFlowNode>) {
  const viewport = useViewport()
  const zoom = data.canvas.fitMode === "manual" ? data.canvas.zoom : viewport.zoom
  return (
    <>
      <Handle className="pointer-events-none opacity-0" position={Position.Left} type="target" />
      <CanvasPreviewDevice {...data} zoom={zoom} />
      <Handle className="pointer-events-none opacity-0" position={Position.Right} type="source" />
    </>
  )
})

const CANVAS_NODE_TYPES = {
  "device-preview": DevicePreviewFlowNode,
} satisfies NodeTypes

function hasPayload(event: DragEvent<HTMLElement>, type: string) {
  return Array.from(event.dataTransfer.types ?? []).includes(type)
}

function isFormControl(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select, button, [contenteditable='true']") ||
      target.closest("input, textarea, select, button, [contenteditable='true']") !== null)
  )
}

function fitViewOptions(duration: number) {
  return {
    duration,
    maxZoom: STUDIO_CANVAS_ZOOM_BOUNDS.max,
    minZoom: STUDIO_CANVAS_ZOOM_BOUNDS.min,
    padding: { top: "32px", right: "36px", bottom: "88px", left: "36px" },
  } as const
}

function safeFramePosition(position: StudioCanvasFramePosition): StudioCanvasFramePosition | null {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null
  const clamp = (value: number) =>
    Math.min(
      STUDIO_CANVAS_FRAME_POSITION_BOUNDS.max,
      Math.max(STUDIO_CANVAS_FRAME_POSITION_BOUNDS.min, Number(value.toFixed(2))),
    )
  return { x: clamp(position.x), y: clamp(position.y) }
}

// React Flow viewport, selection, and protocol insertion state form one canvas transaction
// boundary; device rendering and geometry calculations are already extracted.
// oxlint-disable-next-line react-doctor/no-giant-component
export function PreviewCanvas({
  mockProducts,
  mockPurchaseState,
}: {
  mockProducts: readonly MockProductDefinition[]
  mockPurchaseState: MockPurchaseState
}) {
  const {
    document,
    hoveredComponentId,
    isDocumentTransactionActive,
    productLayerPreview,
    selectedComponentId,
  } = useEditorStore()
  const editor = useEditorActions()
  const canvas = useStudioWorkspaceSelector(selectCanvasPreferences)
  const framePositions = useStudioWorkspaceSelector(selectFramePositions)
  const layerMetadata = useStudioWorkspaceSelector(selectLayerMetadata)
  const workspace = useStudioWorkspaceActions()
  const flowRef = useRef<ReactFlowInstance<CanvasDeviceFlowNode> | null>(null)
  const [dropNotice, setDropNotice] = useState<CanvasNotice | null>(null)
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null)
  const [transientFramePositions, setTransientFramePositions] = useState<TransientFramePositions>(
    () => ({ workspaceBase: framePositions, positions: {} }),
  )
  const [runtime, setRuntime] = useState(() => previewRuntimeState(document))
  const now = Date.parse(canvas.countdownPreviewAt)

  let activeRuntime = runtime
  if (runtime.document !== document) {
    activeRuntime = previewRuntimeState(document)
    setRuntime(activeRuntime)
  }
  const { carouselPages, selectedProducts, switchValues } = activeRuntime

  const lockedIds = useMemo(() => new Set(layerMetadata.lockedIds), [layerMetadata.lockedIds])
  const hiddenIds = useMemo(
    () => new Set(layerMetadata.canvasHiddenIds),
    [layerMetadata.canvasHiddenIds],
  )
  const preset = useMemo(() => getCanvasDevicePreset(canvas.device), [canvas.device])
  const geometry = useMemo(
    () => resolveCanvasDeviceGeometry(canvas.device, canvas.orientation),
    [canvas.device, canvas.orientation],
  )
  const nodeGeometry = useMemo(
    () => resolveCanvasDeviceNodeGeometry(canvas.device, canvas.orientation),
    [canvas.device, canvas.orientation],
  )

  const purchaseDisabledIds = useMemo(
    () =>
      new Set(
        document
          ? paywallRuntimeDiagnostics(document, switchValues)
              .map((diagnostic) => diagnostic.componentId)
              .filter((componentId): componentId is string => Boolean(componentId))
          : [],
      ),
    [document, switchValues],
  )

  const syncViewport = useCallback(
    (flow: ReactFlowInstance<CanvasDeviceFlowNode>, duration: number) => {
      if (canvas.fitMode === "fit") {
        void flow.fitView(fitViewOptions(duration))
        return
      }
      void flow.zoomTo(canvas.zoom, { duration })
    },
    [canvas.fitMode, canvas.zoom],
  )

  useEffect(() => {
    const flow = flowRef.current
    if (!flow) return
    syncViewport(flow, 0)
  }, [canvas.device, canvas.orientation, nodeGeometry, syncViewport])

  if (!document) return null
  const activeDocument = document
  const activeScreen =
    screenContainingNode(document, selectedComponentId) ?? initialScreen(document)
  const direction = canvas.forceRTL
    ? "rtl"
    : (document.localization.locales[canvas.locale]?.direction ?? "ltr")
  const visibleSelectableIds = [
    ...document.screens.map((screen) => screen.layout.content),
    ...flattenDocument(document).map((entry) => entry.node),
  ].flatMap((node) =>
    !canvasNodeIsUnavailable(document, node.id, hiddenIds) &&
    !canvasNodeIsUnavailable(document, node.id, lockedIds)
      ? node.id
      : [],
  )

  function insertionLockReason() {
    const location = resolveLegacyInsertionLocation(activeDocument, selectedComponentId)
    if (canvasNodeIsUnavailable(activeDocument, location.parentId, lockedIds)) {
      return "The insertion Stack is locked. Unlock it in Layers before dropping content."
    }
    if (isDocumentTransactionActive) {
      return "Finish the active text or property edit before dropping content."
    }
    return null
  }

  function handleCatalogDragOver(event: DragEvent<HTMLElement>) {
    if (!hasPayload(event, COMPONENT_LIBRARY_DRAG_TYPE)) return
    event.preventDefault()
    const block = insertionLockReason()
    event.dataTransfer.dropEffect = block ? "none" : "copy"
    setDropNotice({
      tone: block ? "danger" : "ready",
      message: block ?? "Drop to insert at the current Layers selection.",
    })
  }

  function handleCatalogDrop(event: DragEvent<HTMLElement>) {
    if (!hasPayload(event, COMPONENT_LIBRARY_DRAG_TYPE)) return
    event.preventDefault()
    const block = insertionLockReason()
    if (block) {
      setDropNotice({ tone: "danger", message: block })
      return
    }
    const rawType = event.dataTransfer.getData(COMPONENT_LIBRARY_DRAG_TYPE)
    if (!COMPONENT_CATALOG_BY_TYPE.has(rawType as InsertableBlockType)) {
      setDropNotice({
        tone: "danger",
        message: "That component is not supported. Drag a Protocol 0.2 component from Add content.",
      })
      return
    }
    const type = rawType as InsertableBlockType
    const location = resolveLegacyInsertionLocation(activeDocument, selectedComponentId, type)
    const label = COMPONENT_CATALOG_BY_TYPE.get(type)?.label ?? type
    const countdownEndsAt = event.dataTransfer.getData(
      COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE,
    )
    if (type === "countdown" && !isValidCountdownInstant(countdownEndsAt)) {
      setDropNotice({
        tone: "danger",
        message: "Countdown needs an explicit valid UTC deadline from Add content.",
      })
      return
    }
    const result = editor.insertComponentAt(
      type,
      location,
      type === "countdown" ? { countdownEndsAt } : undefined,
    )
    if (result.status === "rejected") {
      setDropNotice({ tone: "danger", message: `${result.message} ${result.recovery}` })
      return
    }
    workspace.recordRecentInsertion(type)
    setDropNotice({
      tone: "success",
      message: `${label} inserted. The change can be undone.`,
    })
  }

  function beginInlineEdit(node: ProtocolNode) {
    if (!getEditableCanvasText(node) || editingComponentId === node.id) return
    if (!editor.beginDocumentTransaction()) {
      setDropNotice({
        tone: "danger",
        message: "Finish the active edit before editing this label.",
      })
      return
    }
    setEditingComponentId(node.id)
  }

  function updateInlineEdit(node: ProtocolNode, value: string) {
    const editable = getEditableCanvasText(node)
    if (!editable) return
    editor.updateDocumentInTransaction((current) =>
      updateLocalizedProperty({
        componentId: node.id,
        document: current,
        locale: canvas.locale,
        property: editable.property,
        value,
      }),
    )
  }

  function commitInlineEdit() {
    if (!editingComponentId) return
    editor.commitDocumentTransaction()
    setEditingComponentId(null)
  }

  function cancelInlineEdit() {
    if (!editingComponentId) return
    editor.cancelDocumentTransaction()
    setEditingComponentId(null)
  }

  function handleCanvasKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || isFormControl(event.target)) return
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    const currentIndex = visibleSelectableIds.indexOf(selectedComponentId ?? "")
    const offset = event.key === "ArrowDown" ? 1 : -1
    const nextIndex =
      currentIndex < 0
        ? offset > 0
          ? 0
          : visibleSelectableIds.length - 1
        : Math.min(visibleSelectableIds.length - 1, Math.max(0, currentIndex + offset))
    editor.selectComponent(visibleSelectableIds[nextIndex] ?? null)
  }

  function handleNodeChanges(changes: NodeChange<CanvasDeviceFlowNode>[]) {
    const positionChanges = changes.filter(
      (change): change is Extract<NodeChange<CanvasDeviceFlowNode>, { type: "position" }> =>
        change.type === "position" && Boolean(change.position),
    )
    if (positionChanges.length === 0) return
    setTransientFramePositions((current) => {
      const next = {
        ...(current.workspaceBase === framePositions ? current.positions : {}),
      }
      positionChanges.forEach((change) => {
        const screenId = [...deviceNodeIdByScreenId].find(([, nodeId]) => nodeId === change.id)?.[0]
        const position = change.position ? safeFramePosition(change.position) : null
        if (screenId && position) next[screenId] = position
      })
      return { workspaceBase: framePositions, positions: next }
    })
  }

  function handleMoveEnd(event: globalThis.MouseEvent | TouchEvent | null, viewport: Viewport) {
    if (!event) return
    workspace.setCanvasPreference("fitMode", "manual")
    workspace.setCanvasPreference(
      "zoom",
      Math.min(
        STUDIO_CANVAS_ZOOM_BOUNDS.max,
        Math.max(STUDIO_CANVAS_ZOOM_BOUNDS.min, Number(viewport.zoom.toFixed(2))),
      ),
    )
  }

  const sharedNodeProps = {
    carouselPages,
    document,
    direction,
    editingComponentId,
    hiddenIds,
    hoveredComponentId,
    locale: canvas.locale,
    lockedIds,
    mockProducts,
    mockPurchaseState,
    now,
    onBeginEdit: beginInlineEdit,
    onCancelEdit: cancelInlineEdit,
    onCarouselPageChange: (id: string, index: number) =>
      setRuntime((current) => {
        const base = current.document === document ? current : previewRuntimeState(document)
        return { ...base, carouselPages: { ...base.carouselPages, [id]: index } }
      }),
    onCommitEdit: commitInlineEdit,
    onProductSelect: (id: string, productCardId: string) =>
      setRuntime((current) => {
        const base = current.document === document ? current : previewRuntimeState(document)
        return { ...base, selectedProducts: { ...base.selectedProducts, [id]: productCardId } }
      }),
    onSwitchChange: (id: string, value: boolean) =>
      setRuntime((current) => {
        const base = current.document === document ? current : previewRuntimeState(document)
        return { ...base, switchValues: { ...base.switchValues, [id]: value } }
      }),
    onUpdateEdit: updateInlineEdit,
    purchaseDisabledIds,
    productLayerPreview,
    selectedComponentId,
    selectedProducts,
    switchValues,
  } satisfies Omit<PreviewNodeProps, "inheritedLocked" | "node">

  const deviceNodeIdByScreenId = new Map(
    document.screens.map((screen, index) => [
      screen.id,
      index === 0 ? DEVICE_NODE_ID : `${DEVICE_NODE_ID}-${screen.id}`,
    ]),
  )
  const selectedScreen = screenContainingNode(document, selectedComponentId) ?? activeScreen
  const columnGap = nodeGeometry.width + 140
  const rowGap = nodeGeometry.height + 120
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(document.screens.length)))
  const devicePositions =
    transientFramePositions.workspaceBase === framePositions
      ? transientFramePositions.positions
      : {}
  const deviceNodes: CanvasDeviceFlowNode[] = document.screens.map((screen, index) => {
    const id = deviceNodeIdByScreenId.get(screen.id)!
    const screenPresentation =
      (screen as Screen & { presentation?: { type: "screen" | "sheet" } }).presentation?.type ??
      "screen"
    const previewChildren = screen.layout.content.children.map((node) => (
      <PreviewNode
        {...sharedNodeProps}
        inheritedLocked={lockedIds.has(screen.layout.content.id)}
        key={node.id}
        node={node}
      />
    ))
    const fallbackPosition = {
      x: (index % columnCount) * columnGap,
      y: Math.floor(index / columnCount) * rowGap,
    }
    return {
      id,
      type: "device-preview",
      position: devicePositions[screen.id] ?? framePositions[screen.id] ?? fallbackPosition,
      data: {
        active: selectedScreen.id === screen.id,
        canvas,
        children: previewChildren,
        direction,
        document,
        geometry,
        initial: document.initialScreenId === screen.id,
        layout: screen.layout,
        nodeGeometry,
        onFrameSelect: () => editor.selectComponent(screen.layout.id),
        onRootClick: (event) => {
          if (event.target === event.currentTarget && !lockedIds.has(screen.layout.content.id)) {
            editor.selectComponent(screen.layout.content.id)
          }
        },
        onRootSelect: () => {
          if (!lockedIds.has(screen.layout.content.id)) {
            editor.selectComponent(screen.layout.content.id)
          }
        },
        presentation: screenPresentation,
        preset,
        rootHidden:
          hiddenIds.has(screen.layout.content.id) ||
          !evaluateVisibility(screen.layout.content.visibility, switchValues),
        screenLabel:
          layerMetadata.labels[screen.id]?.trim() ||
          screen.accessibilityLabel?.default ||
          `Screen ${index + 1}`,
        selectedComponentId,
      },
      connectable: false,
      deletable: false,
      dragHandle: ".mosaic-device-drag-handle",
      draggable: true,
      focusable: false,
      height: nodeGeometry.height,
      selectable: false,
      style: {
        height: nodeGeometry.height,
        pointerEvents: "auto",
        width: nodeGeometry.width,
      },
      width: nodeGeometry.width,
    }
  })

  const navigationEdges: Edge[] = flattenDocument(document).flatMap(({ node }) => {
    if (node.type !== "button" || node.action.type !== "navigateTo") return []
    const sourceScreen = screenContainingNode(document, node.id)
    const source = sourceScreen ? deviceNodeIdByScreenId.get(sourceScreen.id) : undefined
    const target = deviceNodeIdByScreenId.get(node.action.screenId)
    if (!source || !target) return []
    return [
      {
        id: `navigation-${node.id}`,
        source,
        target,
        type: "smoothstep",
        label: layerMetadata.labels[node.id]?.trim() || "Navigate",
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { componentId: node.id },
        deletable: false,
        focusable: true,
        selectable: true,
        style: { stroke: "var(--primary)", strokeWidth: 1.75 },
        labelStyle: { fill: "var(--foreground)", fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: "var(--background)", fillOpacity: 0.94 },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 8,
      },
    ]
  })

  return (
    <section
      aria-label="Browser editing preview"
      className={`relative h-full min-h-0 min-w-[420px] overflow-hidden ${
        canvas.appearance === "dark" ? "bg-[#111315]" : "bg-[#f5f5f2]"
      }`}
      onDragOver={handleCatalogDragOver}
      onDrop={handleCatalogDrop}
    >
      <div
        aria-label="Paywall canvas viewport"
        className="h-full w-full focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        data-testid="canvas-viewport"
        onKeyDown={handleCanvasKeyboard}
        role="region"
        tabIndex={0}
      >
        <ReactFlow<CanvasDeviceFlowNode>
          colorMode={canvas.appearance}
          defaultViewport={{ x: 0, y: 0, zoom: canvas.zoom }}
          deleteKeyCode={null}
          edges={navigationEdges}
          elementsSelectable
          fitView={canvas.fitMode === "fit"}
          fitViewOptions={fitViewOptions(0)}
          maxZoom={STUDIO_CANVAS_ZOOM_BOUNDS.max}
          minZoom={STUDIO_CANVAS_ZOOM_BOUNDS.min}
          nodeTypes={CANVAS_NODE_TYPES}
          nodes={deviceNodes}
          nodesConnectable={false}
          nodesDraggable
          onInit={(flow) => {
            flowRef.current = flow
            syncViewport(flow, 0)
          }}
          onMoveEnd={handleMoveEnd}
          onNodeDragStop={(_, node) => {
            const screenId = [...deviceNodeIdByScreenId].find(
              ([, nodeId]) => nodeId === node.id,
            )?.[0]
            const position = safeFramePosition(node.position)
            if (screenId && position) workspace.setFramePosition(screenId, position)
          }}
          onNodesChange={handleNodeChanges}
          onEdgeClick={(_, edge) => {
            const componentId = edge.data?.componentId
            if (typeof componentId === "string") editor.selectComponent(componentId)
          }}
          panOnDrag
          panOnScroll
          proOptions={{ hideAttribution: true }}
          zoomOnDoubleClick={false}
        >
          <Background
            color={canvas.appearance === "dark" ? "#34383d" : "#d5d5cf"}
            gap={24}
            size={1.25}
            variant={BackgroundVariant.Dots}
          />

          {dropNotice ? (
            <Panel position="top-center">
              <div
                aria-live={dropNotice.tone === "danger" ? "assertive" : "polite"}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur ${
                  dropNotice.tone === "danger"
                    ? "border-destructive/30 bg-background/95 text-destructive"
                    : "border-primary/30 bg-background/95 text-primary"
                }`}
                role={dropNotice.tone === "danger" ? "alert" : "status"}
              >
                {dropNotice.message}
              </div>
            </Panel>
          ) : null}

          <Panel position="bottom-center">
            <CanvasPreviewToolbar />
          </Panel>
        </ReactFlow>
      </div>
    </section>
  )
}
