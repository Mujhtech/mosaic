import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple"
import { StatusMessage } from "@mosaic/design-system"
import { lazy, Suspense, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { PreviewCanvas } from "@/features/paywall-editor/components/preview-canvas"
import { PreviewConnectionPanel } from "@/features/paywall-editor/components/preview-connection-panel"
import { PropertyInspector } from "@/features/paywall-editor/components/property-inspector"
import type { StudioWorkspaceCommand } from "@/features/paywall-editor/components/studio-command-palette"
import {
  StudioResizableWorkspace,
  type StudioResizableWorkspaceHandle,
} from "@/features/paywall-editor/components/studio-resizable-workspace"
import { StudioToolbar } from "@/features/paywall-editor/components/studio-toolbar"
import { StudioToolPanel } from "@/features/paywall-editor/components/studio-tool-panel"
import { ValidationPanel } from "@/features/paywall-editor/components/validation-panel"
import { useDraftAutosaveController } from "@/features/paywall-editor/hooks/use-draft-autosave"
import { useEditorHistory } from "@/features/paywall-editor/hooks/use-editor-history"
import { useEditorKeyboardShortcuts } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts"
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection"
import { useEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation"
import { usePreviewConnection } from "@/features/paywall-editor/hooks/use-preview-connection"
import { useStudioViewportMode } from "@/features/paywall-editor/hooks/use-studio-viewport-mode"
import { serializeDocument } from "@/features/paywall-editor/mutations/local-project-file"
import type { EditorState } from "@/features/paywall-editor/stores/editor-store"
import {
  useEditorActions,
  useEditorStoreSelector,
} from "@/features/paywall-editor/stores/editor-store-context"
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import type {
  MockProductDefinition,
  MockPurchaseState,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor"
import {
  focusDocumentValidationIssue,
  focusInspectorValidationIssue,
} from "@/features/paywall-editor/utils/property-inspector-navigation"

const selectDocument = (state: EditorState) => state.document
const selectEditableDocumentId = (state: EditorState) => state.editableDocumentId
const selectCurrentLocale = (state: EditorState) => state.currentLocale
const selectTextScale = (state: EditorState) => state.textScale
const selectLocalRevisionSequence = (state: EditorState) => state.localRevisionSequence
const selectCanvasAppearance = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.canvas.appearance

const StudioCommandPalette = lazy(() =>
  import("@/features/paywall-editor/components/studio-command-palette").then((module) => ({
    default: module.StudioCommandPalette,
  })),
)

function downloadStudioDocument(name: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${name}.mosaic.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export interface EditorShellProps {
  readonly mockProducts: readonly MockProductDefinition[]
  readonly mockPurchaseState: MockPurchaseState
  readonly importError: string | null
  readonly onProductsChange: (products: MockProductDefinition[]) => void
  readonly onPurchaseStateChange: (state: MockPurchaseState) => void
  readonly onImport: (file: File) => void
}

export function EditorShell({
  mockProducts,
  mockPurchaseState,
  importError,
  onProductsChange,
  onPurchaseStateChange,
  onImport,
}: EditorShellProps) {
  const workspaceControllerRef = useRef<StudioResizableWorkspaceHandle | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const document = useEditorStoreSelector(selectDocument)
  const editableDocumentId = useEditorStoreSelector(selectEditableDocumentId)
  const currentLocale = useEditorStoreSelector(selectCurrentLocale)
  const textScale = useEditorStoreSelector(selectTextScale)
  const localRevisionSequence = useEditorStoreSelector(selectLocalRevisionSequence)
  const canvasAppearance = useStudioWorkspaceSelector(selectCanvasAppearance)
  const { setLocalRevisionSequence } = useEditorActions()
  const workspaceActions = useStudioWorkspaceActions()
  const { canUndo, canRedo, undo, redo } = useEditorHistory()
  const validation = useEditorValidation()
  const { selectComponent } = useEditorSelection()
  const autosave = useDraftAutosaveController(mockPurchaseState, mockProducts)
  const viewportMode = useStudioViewportMode()
  useEditorKeyboardShortcuts({
    onFitCanvas: () => workspaceActions.setCanvasPreference("fitMode", "fit"),
    onOpenCommandPalette: () => setCommandPaletteOpen(true),
    onOpenTool: (tool) => {
      workspaceActions.setSelectedTool(tool)
      workspaceControllerRef.current?.expand("left")
    },
    onResetZoom: () => {
      workspaceActions.setCanvasPreference("fitMode", "manual")
      workspaceActions.setCanvasPreference("zoom", 1)
    },
    onToggleAppearance: () =>
      workspaceActions.setCanvasPreference(
        "appearance",
        canvasAppearance === "light" ? "dark" : "light",
      ),
    onTogglePanel: (panel) => workspaceControllerRef.current?.toggle(panel),
  })
  const preview = usePreviewConnection({
    document,
    editableDocumentId,
    locale: currentLocale,
    textScale,
    isValid: validation.isValid,
    mockPurchaseState,
    mockProducts,
    initialRevisionSequence: localRevisionSequence,
    onRevisionDispatched: setLocalRevisionSequence,
  })

  if (!document) return null
  const activeDocument = document

  function navigateToValidationIssue(issue: ValidationIssue) {
    selectComponent(issue.componentId ?? null)
    if (!issue.componentId) {
      workspaceActions.setSelectedTool("localization")
      workspaceControllerRef.current?.expand("left")
    } else {
      workspaceControllerRef.current?.expand("properties")
    }
    window.setTimeout(() => {
      if (issue.componentId && focusInspectorValidationIssue(issue)) return
      if (!issue.componentId && focusDocumentValidationIssue(issue)) return
      const fallback = issue.componentId
        ? window.document.querySelector<HTMLElement>("#property-inspector-title")
        : window.document.querySelector<HTMLElement>("#preview-context-title")
      fallback?.scrollIntoView?.({ block: "center" })
      fallback?.focus()
    }, 0)
  }

  function exportDocument() {
    if (!validation.isValid) {
      workspaceControllerRef.current?.expand("diagnostics")
      const firstIssue = validation.errors[0]
      if (firstIssue) navigateToValidationIssue(firstIssue)
      return
    }

    downloadStudioDocument(activeDocument.id, serializeDocument(activeDocument))
  }

  function openPreviewConnections() {
    workspaceControllerRef.current?.expand("diagnostics")
    window.setTimeout(() => {
      const panel = window.document.querySelector<HTMLElement>("#connected-preview-panel")
      panel?.scrollIntoView?.({ block: "nearest" })
      panel?.focus({ preventScroll: true })
    }, 0)
  }

  function runWorkspaceCommand(command: StudioWorkspaceCommand) {
    switch (command) {
      case "expand-left":
        workspaceControllerRef.current?.expand("left")
        break
      case "toggle-left":
        workspaceControllerRef.current?.toggle("left")
        break
      case "toggle-properties":
        workspaceControllerRef.current?.toggle("properties")
        break
      case "toggle-diagnostics":
        workspaceControllerRef.current?.toggle("diagnostics")
        break
      case "reset":
        workspaceControllerRef.current?.reset()
        break
    }
  }

  const validationSummary = validation.isValid
    ? "Validation ready"
    : `${validation.errors.length} validation ${validation.errors.length === 1 ? "issue" : "issues"}`
  const diagnosticsPanel = (
    <section
      aria-label="Studio diagnostics"
      className="bg-card h-full overflow-hidden"
      data-slot="studio-diagnostics"
    >
      <div className="border-border flex h-8 items-center justify-between gap-3 border-b px-3 text-xs">
        <span className="font-semibold">Diagnostics</span>
        <span className="text-muted-foreground truncate">
          {validationSummary} · Preview clients · {preview.aggregate.total}
        </span>
      </div>
      <div className="h-[calc(100%-2rem)] overflow-y-auto p-4">
        {importError ? (
          <StatusMessage
            className="border-destructive/25 bg-destructive/5 mb-4 rounded-lg border p-3 text-sm"
            tone="danger"
          >
            <p className="font-semibold">Import was not applied</p>
            <p className="text-muted-foreground mt-1">{importError}</p>
            <p className="text-muted-foreground mt-1 text-xs">Your open paywall is unchanged.</p>
          </StatusMessage>
        ) : null}
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <ValidationPanel issues={validation.issues} onNavigate={navigateToValidationIssue} />
          <PreviewConnectionPanel
            acknowledgements={preview.acknowledgements}
            aggregate={preview.aggregate}
            clients={preview.clients}
            diagnostics={preview.diagnostics}
            document={document}
            endpoint={preview.endpoint}
            latestSentEditableDocumentId={preview.latestSentEditableDocumentId}
            latestSentRevisionId={preview.latestSentRevisionId}
            onReconnect={preview.reconnect}
            sessionId={preview.sessionId}
            status={preview.status}
          />
        </div>
      </div>
    </section>
  )

  return (
    <div className="bg-background flex h-full min-h-0 flex-col" data-testid="studio-editor-shell">
      <StudioToolbar
        autosave={autosave}
        canRedo={canRedo}
        canUndo={canUndo}
        documentIdentity={document.id}
        onBack={autosave.flush}
        onExport={exportDocument}
        onOpenPreviewConnections={openPreviewConnections}
        onRequestImport={() => importInputRef.current?.click()}
        onRedo={redo}
        onUndo={undo}
        previewClientCount={preview.aggregate.total}
        previewSummary={preview.aggregate.label}
      />
      <input
        ref={importInputRef}
        accept="application/json,.json"
        aria-label="Import Mosaic JSON file"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImport(file)
          event.target.value = ""
        }}
        type="file"
      />

      {commandPaletteOpen ? (
        <Suspense
          fallback={
            <span aria-live="polite" className="sr-only">
              Loading Studio commands
            </span>
          }
        >
          <StudioCommandPalette
            onExport={exportDocument}
            onOpenChange={setCommandPaletteOpen}
            onRequestImport={() => importInputRef.current?.click()}
            onWorkspaceCommand={runWorkspaceCommand}
            open
          />
        </Suspense>
      ) : null}

      <div className="min-h-0 flex-1">
        <StudioResizableWorkspace
          ref={workspaceControllerRef}
          canvas={
            <section
              aria-labelledby="studio-canvas-title"
              className="h-full min-h-0 overflow-hidden"
            >
              <h2 className="sr-only" id="studio-canvas-title">
                Paywall canvas
              </h2>
              <PreviewCanvas mockProducts={mockProducts} mockPurchaseState={mockPurchaseState} />
            </section>
          }
          desktopRequiredContent={
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm leading-6">
                Your single local draft remains in this browser. You can still export a valid copy
                before moving to a larger display.
              </p>
              <Button
                className="transition-none motion-reduce:transition-none"
                onClick={exportDocument}
                title={
                  validation.isValid
                    ? "Export paywall JSON"
                    : "Fix validation issues on a larger display before export"
                }
                type="button"
              >
                <DownloadSimpleIcon aria-hidden />
                Export local draft
              </Button>
            </div>
          }
          diagnosticsPanel={diagnosticsPanel}
          onOpenCommands={() => setCommandPaletteOpen(true)}
          leftPanel={
            <StudioToolPanel
              assets={document.assets}
              mockProducts={mockProducts}
              mockPurchaseState={mockPurchaseState}
              onProductsChange={onProductsChange}
              onPurchaseStateChange={onPurchaseStateChange}
              previewClients={preview.clients}
              viewportMode={viewportMode}
              workspaceControllerRef={workspaceControllerRef}
            />
          }
          propertiesPanel={
            <aside aria-label="Component properties" className="bg-card h-full overflow-y-auto p-4">
              <PropertyInspector issues={validation.issues} />
            </aside>
          }
          viewportMode={viewportMode}
        />
      </div>
    </div>
  )
}
