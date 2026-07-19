import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal"
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import type { ReactNode, Ref } from "react"

import { Button } from "@/components/ui/button"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import type {
  ResizableLayoutChangedMeta,
  ResizablePanelImperativeHandle,
} from "@/components/ui/resizable"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { StudioActivityRail } from "@/features/paywall-editor/components/studio-activity-rail"
import { DEFAULT_STUDIO_WORKSPACE_PREFERENCES } from "@/features/paywall-editor/constants/studio-workspace"
import type { StudioViewportMode } from "@/features/paywall-editor/hooks/use-studio-viewport-mode"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  StudioWorkspaceActions,
  StudioWorkspaceSnapshot,
} from "@/features/paywall-editor/stores/studio-workspace-store"
import type {
  StudioWorkspacePanel,
  StudioWorkspacePanelPreference,
} from "@/features/paywall-editor/types/studio-workspace"
import {
  commitCompletedPanelLayout,
  commitUpstreamDoubleClickResult,
  restoreWorkspacePanelPreferences,
} from "@/features/paywall-editor/utils/resizable-workspace-layout"

const selectPanelPreferences = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.panels
const selectSelectedTool = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.selectedTool
const selectLatestPersistence = (snapshot: StudioWorkspaceSnapshot) => snapshot.latestPersistence

export interface StudioResizableWorkspaceProps {
  readonly ref?: Ref<StudioResizableWorkspaceHandle>
  readonly viewportMode: StudioViewportMode
  readonly leftPanel: ReactNode
  readonly canvas: ReactNode
  readonly propertiesPanel: ReactNode
  readonly diagnosticsPanel: ReactNode
  readonly desktopRequiredContent: ReactNode
  readonly onOpenCommands: () => void
}

export interface StudioResizableWorkspaceHandle {
  collapse: (panel: StudioWorkspacePanel) => boolean
  expand: (panel: StudioWorkspacePanel) => boolean
  toggle: (panel: StudioWorkspacePanel) => boolean
  reset: () => boolean
}

function CompactPropertiesSheet({
  children,
  onOpenChange,
  open,
}: {
  readonly children: ReactNode
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetTrigger
        render={
          <Button
            className="absolute top-2 right-2 z-20 transition-none motion-reduce:transition-none"
            size="sm"
            type="button"
            variant="outline"
          />
        }
      >
        <SlidersHorizontalIcon aria-hidden />
        Properties
      </SheetTrigger>
      <SheetContent className="w-[min(90vw,560px)] sm:max-w-[560px]" side="right">
        <SheetHeader>
          <SheetTitle>Properties</SheetTitle>
          <SheetDescription>
            Edit the selected component without hiding the Studio canvas.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto" data-slot="studio-compact-properties">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DesktopRequiredWorkspace({ children }: { readonly children: ReactNode }) {
  return (
    <section
      aria-labelledby="studio-desktop-required-title"
      className="bg-background text-foreground grid min-h-full place-items-center p-6"
      data-studio-viewport-mode="desktop-required"
      data-testid="studio-desktop-required"
    >
      <div className="border-border bg-card w-full max-w-xl rounded-xl border p-6 shadow-sm">
        <h1 id="studio-desktop-required-title" className="text-lg font-semibold">
          Studio requires a larger screen
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Use a display at least 768 pixels wide to edit this paywall safely.
        </p>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  )
}

// The workspace coordinates one upstream panel group and its imperative handles; geometry helpers,
// persistence, compact-sheet UI, and activity rail are separate modules/components.
// oxlint-disable-next-line react-doctor/no-giant-component
export function StudioResizableWorkspace({
  ref,
  viewportMode,
  leftPanel,
  canvas,
  propertiesPanel,
  diagnosticsPanel,
  desktopRequiredContent,
  onOpenCommands,
}: StudioResizableWorkspaceProps) {
  const panelPreferences = useStudioWorkspaceSelector(selectPanelPreferences)
  const selectedTool = useStudioWorkspaceSelector(selectSelectedTool)
  const latestPersistence = useStudioWorkspaceSelector(selectLatestPersistence)
  const actions = useStudioWorkspaceActions()
  const leftPanelRef = useRef<ResizablePanelImperativeHandle | null>(null)
  const propertiesPanelRef = useRef<ResizablePanelImperativeHandle | null>(null)
  const diagnosticsPanelRef = useRef<ResizablePanelImperativeHandle | null>(null)
  const restoredViewportModeRef = useRef<StudioViewportMode | null>(null)
  const restoringViewportModeRef = useRef<StudioViewportMode | null>(null)
  const observedResetRef = useRef<typeof latestPersistence | null>(null)
  const pendingCommitsRef = useRef(new Map<StudioWorkspacePanel, number>())
  const compactPropertiesOpenRef = useRef(false)
  const [compactPropertiesOpen, setCompactPropertiesOpenState] = useState(false)
  const hasResizableProperties = viewportMode === "large" || viewportMode === "medium"

  const setCompactPropertiesOpen = useCallback(
    (open: boolean) => {
      if (viewportMode !== "compact" || compactPropertiesOpenRef.current === open) return false
      compactPropertiesOpenRef.current = open
      setCompactPropertiesOpenState(open)
      return true
    },
    [viewportMode],
  )

  // Leaving compact mode closes an external Sheet surface; this synchronizes a Base UI boundary,
  // rather than deriving display state from viewportMode.
  // oxlint-disable react-doctor/no-adjust-state-on-prop-change, react-doctor/no-reset-all-state-on-prop-change
  useEffect(() => {
    if (viewportMode === "compact" || !compactPropertiesOpenRef.current) return
    compactPropertiesOpenRef.current = false
    setCompactPropertiesOpenState(false)
  }, [viewportMode])
  // oxlint-enable react-doctor/no-adjust-state-on-prop-change, react-doctor/no-reset-all-state-on-prop-change

  const restoreVisiblePanelPreferences = useCallback(
    (preferences: StudioWorkspaceSnapshot["preferences"]["panels"]) => {
      if (restoringViewportModeRef.current === viewportMode) return false
      if (viewportMode === "desktop-required") {
        restoredViewportModeRef.current = viewportMode
        return true
      }

      restoringViewportModeRef.current = viewportMode
      const ready = restoreWorkspacePanelPreferences({
        diagnosticsPanelHandle: diagnosticsPanelRef.current,
        includeProperties: hasResizableProperties,
        leftPanelHandle: leftPanelRef.current,
        preferences,
        propertiesPanelHandle: propertiesPanelRef.current,
      })
      restoringViewportModeRef.current = null
      if (ready) restoredViewportModeRef.current = viewportMode
      return ready
    },
    [hasResizableProperties, viewportMode],
  )

  useEffect(() => {
    if (restoredViewportModeRef.current !== viewportMode) {
      restoreVisiblePanelPreferences(panelPreferences)
    }
  }, [panelPreferences, restoreVisiblePanelPreferences, viewportMode])

  useEffect(() => {
    if (latestPersistence.operation !== "reset" || observedResetRef.current === latestPersistence) {
      return
    }

    observedResetRef.current = latestPersistence
    restoredViewportModeRef.current = null
    restoreVisiblePanelPreferences(DEFAULT_STUDIO_WORKSPACE_PREFERENCES.panels)
  }, [latestPersistence, restoreVisiblePanelPreferences])

  useEffect(
    () => () => {
      for (const timeoutId of pendingCommitsRef.current.values()) {
        window.clearTimeout(timeoutId)
      }
      pendingCommitsRef.current.clear()
    },
    [],
  )

  function scheduleCompletedPanelCommit(
    panel: StudioWorkspacePanel,
    panelHandle: ResizablePanelImperativeHandle | null,
    preference: StudioWorkspacePanelPreference,
    meta: ResizableLayoutChangedMeta,
  ) {
    if (!meta.isUserInteraction) {
      if (restoredViewportModeRef.current !== viewportMode) {
        restoreVisiblePanelPreferences(panelPreferences)
      }
      return
    }
    if (!panelHandle) return

    const previousTimeout = pendingCommitsRef.current.get(panel)
    if (previousTimeout !== undefined) window.clearTimeout(previousTimeout)

    const timeoutId = window.setTimeout(() => {
      pendingCommitsRef.current.delete(panel)
      commitCompletedPanelLayout({ actions, meta, panel, panelHandle, preference })
    }, 0)
    pendingCommitsRef.current.set(panel, timeoutId)
  }

  function scheduleDoubleClickPanelCommit(
    panel: StudioWorkspacePanel,
    panelHandle: ResizablePanelImperativeHandle | null,
    preference: StudioWorkspacePanelPreference,
  ) {
    if (!panelHandle) return

    const previousTimeout = pendingCommitsRef.current.get(panel)
    if (previousTimeout !== undefined) window.clearTimeout(previousTimeout)

    const timeoutId = window.setTimeout(() => {
      pendingCommitsRef.current.delete(panel)
      commitUpstreamDoubleClickResult({ actions, panel, panelHandle, preference })
    }, 0)
    pendingCommitsRef.current.set(panel, timeoutId)
  }

  const getPanelHandle = useCallback(
    (panel: StudioWorkspacePanel) => {
      switch (panel) {
        case "left":
          return leftPanelRef.current
        case "properties":
          return hasResizableProperties ? propertiesPanelRef.current : null
        case "diagnostics":
          return diagnosticsPanelRef.current
      }
    },
    [hasResizableProperties],
  )

  const setPanelCollapsed = useCallback(
    (panel: StudioWorkspacePanel, collapsed: boolean) => {
      const panelHandle = getPanelHandle(panel)
      const preference = panelPreferences[panel]
      if (!panelHandle || preference.collapsed === collapsed) return false

      if (collapsed) {
        panelHandle.collapse()
      } else {
        panelHandle.expand()
      }
      return actions.commitPanelLayout(panel, { ...preference, collapsed })
    },
    [actions, getPanelHandle, panelPreferences],
  )

  useImperativeHandle(
    ref,
    () => ({
      collapse: (panel) =>
        panel === "properties" && viewportMode === "compact"
          ? setCompactPropertiesOpen(false)
          : setPanelCollapsed(panel, true),
      expand: (panel) =>
        panel === "properties" && viewportMode === "compact"
          ? setCompactPropertiesOpen(true)
          : setPanelCollapsed(panel, false),
      toggle: (panel) =>
        panel === "properties" && viewportMode === "compact"
          ? setCompactPropertiesOpen(!compactPropertiesOpenRef.current)
          : setPanelCollapsed(panel, !panelPreferences[panel].collapsed),
      reset: () => {
        actions.resetWorkspace()
        return true
      },
    }),
    [actions, panelPreferences, setCompactPropertiesOpen, setPanelCollapsed, viewportMode],
  )

  function setLeftPanelCollapsed(collapsed: boolean) {
    return setPanelCollapsed("left", collapsed)
  }

  function selectTool(tool: Parameters<StudioWorkspaceActions["setSelectedTool"]>[0]) {
    actions.setSelectedTool(tool)
    if (panelPreferences.left.collapsed) {
      setLeftPanelCollapsed(false)
    }
  }

  function toggleActiveTool() {
    setLeftPanelCollapsed(!panelPreferences.left.collapsed)
  }

  if (viewportMode === "desktop-required") {
    return <DesktopRequiredWorkspace>{desktopRequiredContent}</DesktopRequiredWorkspace>
  }

  return (
    <div
      className="bg-background text-foreground flex h-full min-h-0 w-full overflow-hidden"
      data-studio-viewport-mode={viewportMode}
      data-testid="studio-resizable-workspace"
      data-workspace-persistence-operation={latestPersistence.operation}
      data-workspace-persistence-status={latestPersistence.status}
    >
      <StudioActivityRail
        collapsed={panelPreferences.left.collapsed}
        onOpenCommands={onOpenCommands}
        onSelectTool={selectTool}
        onToggleActiveTool={toggleActiveTool}
        selectedTool={selectedTool}
      />

      <div className="relative min-h-0 min-w-0 flex-1" data-slot="studio-workspace-surface">
        <ResizablePanelGroup
          className="min-h-0"
          data-layout-orientation="vertical"
          data-studio-viewport-mode={viewportMode}
          id="studio-root-group"
          onLayoutChanged={(_layout, meta) => {
            scheduleCompletedPanelCommit(
              "diagnostics",
              diagnosticsPanelRef.current,
              panelPreferences.diagnostics,
              meta,
            )
          }}
          orientation="vertical"
        >
          <ResizablePanel className="min-h-0" data-collapsible="false" id="studio-main-panel">
            <ResizablePanelGroup
              className="min-w-0"
              data-layout-orientation="horizontal"
              data-studio-viewport-mode={viewportMode}
              id="studio-horizontal-group"
              onLayoutChanged={(_layout, meta) => {
                scheduleCompletedPanelCommit(
                  "left",
                  leftPanelRef.current,
                  panelPreferences.left,
                  meta,
                )
                if (hasResizableProperties) {
                  scheduleCompletedPanelCommit(
                    "properties",
                    propertiesPanelRef.current,
                    panelPreferences.properties,
                    meta,
                  )
                }
              }}
              orientation="horizontal"
            >
              <ResizablePanel
                collapsedSize="0px"
                collapsible
                data-collapsed-size="0px"
                data-collapsible="true"
                data-default-size="300px"
                data-left-collapsed={panelPreferences.left.collapsed}
                data-max-size="440px"
                data-min-size="240px"
                defaultSize="300px"
                groupResizeBehavior="preserve-pixel-size"
                id="studio-left-panel"
                maxSize="440px"
                minSize="240px"
                panelRef={leftPanelRef}
              >
                {leftPanel}
              </ResizablePanel>

              <ResizableHandle
                aria-label="Resize Studio tools and canvas"
                id="studio-left-handle"
                onDoubleClick={() =>
                  scheduleDoubleClickPanelCommit(
                    "left",
                    leftPanelRef.current,
                    panelPreferences.left,
                  )
                }
                withHandle
              />

              <ResizablePanel
                className="min-w-[420px]"
                data-canvas-min-width="420px"
                data-collapsible="false"
                data-min-size="420px"
                id="studio-canvas-panel"
                minSize="420px"
              >
                {canvas}
              </ResizablePanel>

              {hasResizableProperties ? (
                <>
                  <ResizableHandle
                    aria-label="Resize Studio canvas and properties"
                    id="studio-right-handle"
                    onDoubleClick={() =>
                      scheduleDoubleClickPanelCommit(
                        "properties",
                        propertiesPanelRef.current,
                        panelPreferences.properties,
                      )
                    }
                    withHandle
                  />

                  <ResizablePanel
                    collapsedSize="0px"
                    collapsible
                    data-collapsed-size="0px"
                    data-collapsible="true"
                    data-default-size="360px"
                    data-max-size="560px"
                    data-min-size="300px"
                    defaultSize="360px"
                    groupResizeBehavior="preserve-pixel-size"
                    id="studio-properties-panel"
                    maxSize="560px"
                    minSize="300px"
                    panelRef={propertiesPanelRef}
                  >
                    {propertiesPanel}
                  </ResizablePanel>
                </>
              ) : null}
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle
            aria-label="Resize Studio workspace and diagnostics"
            id="studio-diagnostics-handle"
            onDoubleClick={() =>
              scheduleDoubleClickPanelCommit(
                "diagnostics",
                diagnosticsPanelRef.current,
                panelPreferences.diagnostics,
              )
            }
            withHandle
          />

          <ResizablePanel
            className="min-h-8"
            collapsedSize="32px"
            collapsible
            data-collapsed-size="32px"
            data-collapsible="true"
            data-default-size="220px"
            data-max-size="45vh"
            data-min-size="140px"
            defaultSize="220px"
            groupResizeBehavior="preserve-pixel-size"
            id="studio-diagnostics-panel"
            maxSize="45vh"
            minSize="140px"
            panelRef={diagnosticsPanelRef}
          >
            {diagnosticsPanel}
          </ResizablePanel>
        </ResizablePanelGroup>

        {viewportMode === "compact" ? (
          <CompactPropertiesSheet
            onOpenChange={(open) => setCompactPropertiesOpen(open)}
            open={compactPropertiesOpen}
          >
            {propertiesPanel}
          </CompactPropertiesSheet>
        ) : null}
      </div>
    </div>
  )
}
