import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle"
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple"
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/ssr/PlugsConnected"
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr/UploadSimple"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { StatusMessage, ToolbarGroup } from "@mosaic/design-system"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import type { DraftAutosaveController } from "@/features/paywall-editor/hooks/use-draft-autosave"
import { cn } from "@/lib/utils"

function humanizeDocumentIdentity(identity: string) {
  const words = identity
    .trim()
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")

  if (!words) return "Untitled paywall"
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

function AutosaveStatus({ controller }: { controller: DraftAutosaveController }) {
  if (controller.status === "failed") {
    return (
      <StatusMessage
        className="border-destructive/25 bg-destructive/5 flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs"
        tone="danger"
      >
        <WarningCircleIcon aria-hidden weight="fill" />
        <span>Autosave failed</span>
        <Button
          className="ml-0.5 h-5 px-1.5 transition-none motion-reduce:transition-none"
          onClick={controller.retry}
          size="xs"
          type="button"
          variant="outline"
        >
          Retry
        </Button>
      </StatusMessage>
    )
  }

  const label =
    controller.status === "saving"
      ? "Saving locally"
      : controller.status === "saved"
        ? "Saved locally"
        : "Local draft"

  return (
    <StatusMessage
      className="text-muted-foreground flex h-7 items-center gap-1.5 px-1 text-xs whitespace-nowrap"
      tone={controller.status === "saved" ? "success" : "info"}
    >
      {controller.status === "saved" ? <CheckCircleIcon aria-hidden weight="fill" /> : null}
      <span>{label}</span>
    </StatusMessage>
  )
}

export interface StudioToolbarProps {
  readonly autosave: DraftAutosaveController
  readonly canRedo: boolean
  readonly canUndo: boolean
  readonly documentIdentity: string
  readonly previewClientCount: number
  readonly previewSummary: string
  readonly onBack: () => boolean
  readonly onExport: () => void
  readonly onRequestImport: () => void
  readonly onOpenPreviewConnections: () => void
  readonly onRedo: () => void
  readonly onUndo: () => void
}

const TOOLBAR_BUTTON_CLASS = "transition-none motion-reduce:transition-none"

export function StudioToolbar({
  autosave,
  canRedo,
  canUndo,
  documentIdentity,
  previewClientCount,
  previewSummary,
  onBack,
  onExport,
  onRequestImport,
  onOpenPreviewConnections,
  onRedo,
  onUndo,
}: StudioToolbarProps) {
  return (
    <header className="border-border bg-background flex min-h-12 shrink-0 items-center gap-2 border-b px-2 py-2 lg:px-3">
      <ToolbarGroup aria-label="Studio navigation" className="shrink-0">
        <a
          aria-label="Back to Foundation"
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }), TOOLBAR_BUTTON_CLASS)}
          href="/foundation"
          onClick={(event) => {
            if (!onBack()) event.preventDefault()
          }}
          title="Back to Foundation"
        >
          <ArrowLeftIcon aria-hidden />
          <span className="hidden 2xl:inline">Foundation</span>
        </a>
      </ToolbarGroup>

      <div className="min-w-24 shrink overflow-hidden px-1" data-readonly-document-identity="true">
        <h1
          className="truncate text-sm font-semibold"
          title={humanizeDocumentIdentity(documentIdentity)}
        >
          {humanizeDocumentIdentity(documentIdentity)}
        </h1>
      </div>

      <div className="ml-auto flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto">
        <AutosaveStatus controller={autosave} />

        <ToolbarGroup aria-label="Edit history" className="flex shrink-0 items-center gap-0.5">
          <Button
            aria-label="Undo"
            className={TOOLBAR_BUTTON_CLASS}
            disabled={!canUndo}
            onClick={onUndo}
            size="icon-sm"
            title="Undo (Command or Control + Z)"
            type="button"
            variant="ghost"
          >
            <ArrowCounterClockwiseIcon aria-hidden />
          </Button>
          <Button
            aria-label="Redo"
            className={TOOLBAR_BUTTON_CLASS}
            disabled={!canRedo}
            onClick={onRedo}
            size="icon-sm"
            title="Redo (Command or Control + Shift + Z)"
            type="button"
            variant="ghost"
          >
            <ArrowClockwiseIcon aria-hidden />
          </Button>
        </ToolbarGroup>

        <ToolbarGroup aria-label="Preview connections" className="flex shrink-0 items-center gap-1">
          <Button
            aria-controls="connected-preview-panel"
            aria-describedby="studio-preview-summary"
            aria-label="Open connected previews"
            className={TOOLBAR_BUTTON_CLASS}
            onClick={onOpenPreviewConnections}
            size="sm"
            title={previewSummary}
            type="button"
            variant="ghost"
          >
            <PlugsConnectedIcon aria-hidden />
            <span className="whitespace-nowrap" id="studio-preview-summary">
              Preview clients <span aria-hidden>·</span> {previewClientCount}
            </span>
          </Button>
        </ToolbarGroup>

        <ToolbarGroup aria-label="Local document" className="flex shrink-0 items-center gap-1">
          <Button
            aria-label="Import Mosaic JSON"
            className={TOOLBAR_BUTTON_CLASS}
            onClick={onRequestImport}
            size="sm"
            title="Import Mosaic JSON"
            type="button"
            variant="outline"
          >
            <UploadSimpleIcon aria-hidden />
            <span className="hidden 2xl:inline">Import</span>
          </Button>
          <Button
            className={TOOLBAR_BUTTON_CLASS}
            onClick={onExport}
            size="sm"
            title="Export paywall JSON"
            type="button"
          >
            <DownloadSimpleIcon aria-hidden />
            Export
          </Button>
        </ToolbarGroup>
      </div>
    </header>
  )
}
