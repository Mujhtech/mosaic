import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise"
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr/UploadSimple"
import { useRef } from "react"

import { Button } from "@/components/ui/button"
import { ComponentTree } from "@/features/paywall-editor/components/component-tree"
import { MockCommercePanel } from "@/features/paywall-editor/components/mock-commerce-panel"
import { PreviewCanvas } from "@/features/paywall-editor/components/preview-canvas"
import { PreviewConnectionPanel } from "@/features/paywall-editor/components/preview-connection-panel"
import { PreviewControls } from "@/features/paywall-editor/components/preview-controls"
import { PropertyInspector } from "@/features/paywall-editor/components/property-inspector"
import { ValidationPanel } from "@/features/paywall-editor/components/validation-panel"
import { useDraftAutosave } from "@/features/paywall-editor/hooks/use-draft-autosave"
import { useEditorHistory } from "@/features/paywall-editor/hooks/use-editor-history"
import { useEditorKeyboardShortcuts } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts"
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection"
import { useEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation"
import { usePreviewConnection } from "@/features/paywall-editor/hooks/use-preview-connection"
import { serializeDocument } from "@/features/paywall-editor/mutations/local-project-file"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MockProductDefinition,
  MockPurchaseState,
} from "@/features/paywall-editor/types/editor"

function downloadDocument(name: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${name}.mosaic.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function EditorShell({
  mockProducts,
  mockPurchaseState,
  importError,
  onProductsChange,
  onPurchaseStateChange,
  onImport,
  onChooseTemplate,
}: {
  mockProducts: readonly MockProductDefinition[]
  mockPurchaseState: MockPurchaseState
  importError: string | null
  onProductsChange: (products: MockProductDefinition[]) => void
  onPurchaseStateChange: (state: MockPurchaseState) => void
  onImport: (file: File) => void
  onChooseTemplate: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { document, editableDocumentId, currentLocale, textScale, localRevisionSequence } =
    useEditorStore()
  const { setLocalRevisionSequence } = useEditorActions()
  const { canUndo, canRedo, undo, redo } = useEditorHistory()
  const validation = useEditorValidation()
  const { selectComponent } = useEditorSelection()
  const autosave = useDraftAutosave(mockPurchaseState, mockProducts)
  useEditorKeyboardShortcuts()
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

  return (
    <div className="min-h-[calc(100svh-3.5rem)]">
      <header className="border-border bg-background/95 sticky top-14 z-10 flex flex-wrap items-center gap-3 border-b px-4 py-3 backdrop-blur lg:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{document.id.replaceAll("-", " ")}</h1>
          <div
            className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs"
            aria-live="polite"
          >
            <span>{validation.isValid ? "Valid" : `${validation.errors.length} to fix`}</span>
            <span aria-hidden>·</span>
            <span>
              {autosave === "saving"
                ? "Saving locally…"
                : autosave === "saved"
                  ? "Saved in this browser"
                  : autosave === "failed"
                    ? "Autosave failed — export a copy"
                    : "Local draft"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={undo}
          >
            <ArrowCounterClockwiseIcon aria-hidden />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={redo}
          >
            <ArrowClockwiseIcon aria-hidden />
          </Button>
        </div>
        <Button size="sm" variant="outline" onClick={onChooseTemplate}>
          <SquaresFourIcon aria-hidden />
          Templates
        </Button>
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
          <UploadSimpleIcon aria-hidden />
          Import
        </Button>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Import Mosaic JSON"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onImport(file)
            event.target.value = ""
          }}
        />
        <Button
          size="sm"
          title={validation.isValid ? "Export paywall JSON" : "Fix validation issues before export"}
          onClick={() => {
            if (!validation.isValid) {
              selectComponent(validation.errors[0]?.componentId ?? null)
              const heading = window.document.querySelector<HTMLElement>("#validation-title")
              heading?.scrollIntoView({ behavior: "smooth", block: "center" })
              heading?.focus()
              return
            }
            downloadDocument(document.id, serializeDocument(document))
          }}
        >
          <DownloadSimpleIcon aria-hidden />
          Export
        </Button>
      </header>

      {importError ? (
        <div
          className="border-destructive/25 bg-destructive/5 mx-4 mt-4 rounded-xl border p-3 text-sm lg:mx-6"
          role="alert"
        >
          <p className="font-semibold">Import was not applied</p>
          <p className="text-muted-foreground mt-1">{importError}</p>
          <p className="text-muted-foreground mt-1 text-xs">Your open paywall is unchanged.</p>
        </div>
      ) : null}

      <div className="grid gap-4 p-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:p-6 xl:grid-cols-[15rem_minmax(30rem,1fr)_20rem]">
        <aside className="border-border bg-card h-fit rounded-2xl border p-4 xl:sticky xl:top-32">
          <ComponentTree />
        </aside>

        <div className="min-w-0 space-y-4">
          <PreviewCanvas mockProducts={mockProducts} mockPurchaseState={mockPurchaseState} />
          <div className="border-border bg-card rounded-2xl border p-5">
            <ValidationPanel issues={validation.issues} />
          </div>
          <div className="border-border bg-card rounded-2xl border p-5">
            <PreviewConnectionPanel
              document={document}
              endpoint={preview.endpoint}
              sessionId={preview.sessionId}
              status={preview.status}
              clients={preview.clients}
              diagnostics={preview.diagnostics}
              acknowledgements={preview.acknowledgements}
              aggregate={preview.aggregate}
              latestSentEditableDocumentId={preview.latestSentEditableDocumentId}
              latestSentRevisionId={preview.latestSentRevisionId}
              onReconnect={preview.reconnect}
            />
          </div>
        </div>

        <aside className="space-y-4 lg:col-span-2 lg:grid lg:grid-cols-3 lg:gap-4 lg:space-y-0 xl:sticky xl:top-32 xl:col-span-1 xl:block xl:max-h-[calc(100svh-9rem)] xl:space-y-4 xl:overflow-y-auto xl:pr-1">
          <div className="border-border bg-card rounded-2xl border p-4">
            <PropertyInspector />
          </div>
          <div className="border-border bg-card rounded-2xl border p-4">
            <PreviewControls />
          </div>
          <div className="border-border bg-card rounded-2xl border p-4">
            <MockCommercePanel
              mockProducts={mockProducts}
              mockPurchaseState={mockPurchaseState}
              onProductsChange={onProductsChange}
              onPurchaseStateChange={onPurchaseStateChange}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
