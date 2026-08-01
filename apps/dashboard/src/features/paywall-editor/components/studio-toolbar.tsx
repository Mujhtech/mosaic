import { StatusMessage, ToolbarGroup } from "@mosaic/design-system";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { CloudArrowUpIcon } from "@phosphor-icons/react/dist/ssr/CloudArrowUp";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/ssr/PlugsConnected";
import { RocketLaunchIcon } from "@phosphor-icons/react/dist/ssr/RocketLaunch";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr/UploadSimple";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import type { DraftAutosaveController } from "@/features/paywall-editor/hooks/use-draft-autosave";
import { cn } from "@/lib/utils";

function humanizeDocumentIdentity(identity: string) {
  const words = identity
    .trim()
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");

  if (!words) {
    return "Untitled paywall";
  }
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function AutosaveStatus({
  controller,
  mode,
}: {
  controller: DraftAutosaveController;
  mode: "hosted" | "local";
}) {
  if (controller.status === "failed" || controller.status === "offline") {
    const offline = controller.status === "offline";
    return (
      <StatusMessage
        className="flex h-7 items-center gap-1.5 rounded border border-destructive/25 bg-destructive/5 px-2 text-xs"
        tone="danger"
      >
        <WarningCircleIcon aria-hidden weight="fill" />
        <span>
          {(() => {
            if (offline) {
              return "Offline · edits kept";
            }
            if (mode === "local") {
              return "Autosave failed";
            }
            return "Save failed";
          })()}
        </span>
        <Button
          className="ml-0.5 h-5 px-1.5 transition-none motion-reduce:transition-none"
          onClick={controller.retry}
          size="xs"
          type="button"
          variant="outline"
        >
          {offline ? "Try again" : "Retry"}
        </Button>
      </StatusMessage>
    );
  }

  if (controller.status === "conflict") {
    return (
      <StatusMessage
        className="flex h-7 items-center gap-1.5 rounded border border-destructive/25 bg-destructive/5 px-2 text-xs"
        tone="danger"
      >
        <WarningCircleIcon aria-hidden weight="fill" />
        <span>Save conflict · edits kept</span>
      </StatusMessage>
    );
  }

  const label = (() => {
    if (mode === "local") {
      return (() => {
        if (controller.status === "saving") {
          return "Saving locally";
        }
        if (controller.status === "saved") {
          return "Saved locally";
        }
        return "Local draft";
      })();
    }
    if (controller.status === "saving") {
      return "Saving hosted Draft";
    }
    if (controller.status === "saved") {
      return "Hosted Draft saved";
    }
    if (controller.status === "unsaved") {
      return "Unsaved changes";
    }
    return "Hosted Draft";
  })();

  return (
    <StatusMessage
      className="flex h-7 items-center gap-1.5 whitespace-nowrap px-1 text-muted-foreground text-xs"
      tone={controller.status === "saved" ? "success" : "info"}
    >
      {controller.status === "saved" ? (
        <CheckCircleIcon aria-hidden weight="fill" />
      ) : null}
      <span>{label}</span>
    </StatusMessage>
  );
}

export interface StudioToolbarProps {
  readonly autosave: DraftAutosaveController;
  readonly backHref?: string;
  readonly backLabel?: string;
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly connectHostedHref?: string;
  readonly documentIdentity: string;
  readonly environmentLabel?: string;
  readonly mode?: "hosted" | "local";
  readonly onBack: () => boolean;
  readonly onConnectHosted?: () => boolean;
  readonly onExport: () => void;
  readonly onOpenPreviewConnections: () => void;
  readonly onPublish?: () => void;
  readonly onRedo: () => void;
  readonly onRequestImport: () => void;
  readonly onUndo: () => void;
  readonly previewClientCount: number;
  readonly previewSummary: string;
  readonly publishDisabled?: boolean;
}

const TOOLBAR_BUTTON_CLASS = "transition-none motion-reduce:transition-none";

export function StudioToolbar({
  autosave,
  canRedo,
  canUndo,
  documentIdentity,
  previewClientCount,
  previewSummary,
  onBack,
  onConnectHosted,
  onExport,
  onRequestImport,
  onOpenPreviewConnections,
  onRedo,
  onUndo,
  mode = "local",
  backHref = "/workspace",
  backLabel = "Workspace",
  environmentLabel,
  onPublish,
  publishDisabled = false,
  connectHostedHref = "/workspace",
}: StudioToolbarProps) {
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-border border-b bg-background px-2 py-2 lg:px-3">
      <ToolbarGroup aria-label="Studio navigation" className="shrink-0">
        <a
          aria-label={`Back to ${backLabel}`}
          className={cn(
            buttonVariants({ size: "sm", variant: "ghost" }),
            TOOLBAR_BUTTON_CLASS
          )}
          href={backHref}
          onClick={(event) => {
            if (!onBack()) {
              event.preventDefault();
            }
          }}
          title={`Back to ${backLabel}`}
        >
          <ArrowLeftIcon aria-hidden />
          <span className="hidden 2xl:inline">{backLabel}</span>
        </a>
      </ToolbarGroup>

      <div
        className="min-w-24 shrink overflow-hidden px-1"
        data-readonly-document-identity="true"
      >
        <h1
          className="truncate font-semibold text-sm"
          title={humanizeDocumentIdentity(documentIdentity)}
        >
          {humanizeDocumentIdentity(documentIdentity)}
        </h1>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {environmentLabel ? (
          <span className="hidden rounded-full border border-border bg-muted/55 px-2.5 py-1 font-medium text-muted-foreground text-xs xl:inline-flex">
            {environmentLabel}
          </span>
        ) : null}
        <AutosaveStatus controller={autosave} mode={mode} />

        <ToolbarGroup
          aria-label="Edit history"
          className="flex shrink-0 items-center gap-0.5"
        >
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

        <ToolbarGroup
          aria-label="Preview connections"
          className="flex shrink-0 items-center gap-1"
        >
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

        <ToolbarGroup
          aria-label={mode === "local" ? "Local document" : "Hosted Draft"}
          className="flex shrink-0 items-center gap-1"
        >
          {mode === "local" && onConnectHosted ? (
            <a
              className={cn(
                buttonVariants({ size: "sm", variant: "outline" }),
                TOOLBAR_BUTTON_CLASS
              )}
              href={connectHostedHref}
              onClick={(event) => {
                if (!onConnectHosted()) {
                  event.preventDefault();
                }
              }}
              title="Save this local document and choose a hosted Project and Environment"
            >
              <CloudArrowUpIcon aria-hidden />
              <span className="hidden 2xl:inline">Connect to hosted</span>
            </a>
          ) : null}
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
          {mode === "hosted" && onPublish ? (
            <Button
              className={TOOLBAR_BUTTON_CLASS}
              disabled={publishDisabled}
              onClick={onPublish}
              size="sm"
              title="Review and publish this hosted Draft"
              type="button"
            >
              <RocketLaunchIcon aria-hidden />
              Publish
            </Button>
          ) : null}
        </ToolbarGroup>
      </div>
    </header>
  );
}
