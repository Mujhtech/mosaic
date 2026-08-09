import { StatusMessage } from "@mosaic/design-system";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { lazy, Suspense, useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PreviewCanvas } from "@/features/paywall-editor/components/preview-canvas";
import { PreviewConnectionPanel } from "@/features/paywall-editor/components/preview-connection-panel";
import { PropertyInspector } from "@/features/paywall-editor/components/property-inspector";
import type { StudioWorkspaceCommand } from "@/features/paywall-editor/components/studio-command-palette";
import {
  StudioResizableWorkspace,
  type StudioResizableWorkspaceHandle,
} from "@/features/paywall-editor/components/studio-resizable-workspace";
import { StudioToolPanel } from "@/features/paywall-editor/components/studio-tool-panel";
import { StudioToolbar } from "@/features/paywall-editor/components/studio-toolbar";
import { ValidationPanel } from "@/features/paywall-editor/components/validation-panel";
import { useDraftAutosaveController } from "@/features/paywall-editor/hooks/use-draft-autosave";
import { useEditorHistory } from "@/features/paywall-editor/hooks/use-editor-history";
import { useEditorKeyboardShortcuts } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts";
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection";
import { useEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation";
import { usePreviewConnection } from "@/features/paywall-editor/hooks/use-preview-connection";
import { useStudioViewportMode } from "@/features/paywall-editor/hooks/use-studio-viewport-mode";
import { serializeDocument } from "@/features/paywall-editor/mutations/local-project-file";
import type { EditorState } from "@/features/paywall-editor/stores/editor-store";
import {
  useEditorActions,
  useEditorStoreSelector,
} from "@/features/paywall-editor/stores/editor-store-context";
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store";
import {
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context";
import { useStudioSource } from "@/features/paywall-editor/stores/use-studio-source";
import type {
  MockProductDefinition,
  MockPurchaseState,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor";
import { hostedStudioBackHref } from "@/features/paywall-editor/types/studio-source";
import {
  focusDocumentValidationIssue,
  focusInspectorValidationIssue,
} from "@/features/paywall-editor/utils/property-inspector-navigation";
import { HostedDraftConflict } from "@/features/paywalls/components/hosted-draft-conflict";
import { useHostedDraftAutosave } from "@/features/paywalls/hooks/use-hosted-draft-autosave";
import { useHostedDraftRecovery } from "@/features/paywalls/hooks/use-hosted-draft-recovery";
import { serializeHostedRecoveryDocument } from "@/features/paywalls/mutations/hosted-draft-recovery";
import { useHostedDraftSession } from "@/features/paywalls/stores/use-hosted-draft-session";
import { HostedPublishPanel } from "@/features/publishing/components/hosted-publish-panel";

const selectDocument = (state: EditorState) => state.document;
const selectEditableDocumentId = (state: EditorState) =>
  state.editableDocumentId;
const selectCurrentLocale = (state: EditorState) => state.currentLocale;
const selectTextScale = (state: EditorState) => state.textScale;
const selectLocalRevisionSequence = (state: EditorState) =>
  state.localRevisionSequence;
const selectCanvasAppearance = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.canvas.appearance;

const StudioCommandPalette = lazy(() =>
  import("@/features/paywall-editor/components/studio-command-palette").then(
    (module) => ({
      default: module.StudioCommandPalette,
    })
  )
);

function downloadStudioDocument(name: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.mosaic.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface EditorShellProps {
  readonly importError: string | null;
  /**
   * Outcomes from an import that was applied but not wholly: an image that
   * failed to upload, or a placement that had to move. Reporting these beside
   * the editor keeps a partial success from reading as a clean one.
   */
  readonly importNotices?: readonly string[];
  readonly mockProducts: readonly MockProductDefinition[];
  readonly mockPurchaseState: MockPurchaseState;
  readonly onImport: (file: File) => void;
  readonly onProductsChange: (products: MockProductDefinition[]) => void;
  readonly onPurchaseStateChange: (state: MockPurchaseState) => void;
}

export function EditorShell({
  mockProducts,
  mockPurchaseState,
  importError,
  importNotices,
  onProductsChange,
  onPurchaseStateChange,
  onImport,
}: EditorShellProps) {
  const source = useStudioSource();
  const hostedSession = useHostedDraftSession();
  const workspaceControllerRef = useRef<StudioResizableWorkspaceHandle | null>(
    null
  );
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [publishReviewOpen, setPublishReviewOpen] = useState(
    source.kind === "hosted" && source.initialReview === "publish"
  );
  const document = useEditorStoreSelector(selectDocument);
  const editableDocumentId = useEditorStoreSelector(selectEditableDocumentId);
  const currentLocale = useEditorStoreSelector(selectCurrentLocale);
  const textScale = useEditorStoreSelector(selectTextScale);
  const localRevisionSequence = useEditorStoreSelector(
    selectLocalRevisionSequence
  );
  const canvasAppearance = useStudioWorkspaceSelector(selectCanvasAppearance);
  const editor = useEditorActions();
  const workspaceActions = useStudioWorkspaceActions();
  const { canUndo, canRedo, undo, redo } = useEditorHistory();
  const validation = useEditorValidation();
  const { selectComponent } = useEditorSelection();
  const localAutosave = useDraftAutosaveController(
    mockPurchaseState,
    mockProducts,
    source.kind === "local"
  );
  const onHostedSaved = useCallback(
    (saved: NonNullable<typeof hostedSession>["draft"]) => {
      hostedSession?.acceptSavedDraft(saved);
      editor.markSaved(saved.document.revision);
    },
    [editor, hostedSession]
  );
  const hostedAutosave = useHostedDraftAutosave({
    document,
    draftId: source.kind === "hosted" ? source.draftId : "local",
    enabled: source.kind === "hosted" && !!hostedSession,
    initialDocument: hostedSession?.draft.document ?? null,
    initialRevision: hostedSession?.draft.revision ?? 0,
    onSaved: onHostedSaved,
    saveDraft:
      hostedSession?.saveDraft ??
      (() => Promise.reject(new Error("Hosted Draft session unavailable"))),
  });
  const autosave = source.kind === "local" ? localAutosave : hostedAutosave;
  const recovery = useHostedDraftRecovery({
    document,
    // A recovery record is restored *against* the revision it diverged from.
    // Without a hosted session there is no such revision, and `0` is a real one
    // — the revision a never-saved Draft has — so the hook is told the truth and
    // writes nothing rather than storing a record bound to the wrong state.
    expectedRevision: hostedSession?.draft.revision ?? null,
    scope:
      source.kind === "hosted"
        ? {
            draftId: source.draftId,
            environmentId: source.environmentId,
            paywallId: source.paywallId,
            projectId: source.projectId,
          }
        : null,
    status: hostedAutosave.status,
  });
  // Bound to a const so the render guard below narrows inside the button
  // callbacks too: a property read would widen again at each call site.
  const recoveryRecord = recovery.record;
  const viewportMode = useStudioViewportMode();
  const hostedEnvironmentName =
    source.kind === "hosted" ? source.environmentName : undefined;
  useEditorKeyboardShortcuts({
    onFitCanvas: () => workspaceActions.setCanvasPreference("fitMode", "fit"),
    onOpenCommandPalette: () => setCommandPaletteOpen(true),
    onOpenTool: (tool) => {
      workspaceActions.setSelectedTool(tool);
      workspaceControllerRef.current?.expand("left");
    },
    onResetZoom: () => {
      workspaceActions.setCanvasPreference("fitMode", "manual");
      workspaceActions.setCanvasPreference("zoom", 1);
    },
    onToggleAppearance: () =>
      workspaceActions.setCanvasPreference(
        "appearance",
        canvasAppearance === "light" ? "dark" : "light"
      ),
    onTogglePanel: (panel) => workspaceControllerRef.current?.toggle(panel),
  });
  const preview = usePreviewConnection({
    document,
    editableDocumentId,
    locale: currentLocale,
    textScale,
    isValid: validation.isValid,
    mockPurchaseState,
    mockProducts,
    initialRevisionSequence: localRevisionSequence,
    onRevisionDispatched: editor.setLocalRevisionSequence,
  });

  if (!document) {
    return null;
  }
  const activeDocument = document;

  function navigateToValidationIssue(issue: ValidationIssue) {
    selectComponent(issue.componentId ?? null);
    if (issue.componentId) {
      workspaceControllerRef.current?.expand("properties");
    } else {
      workspaceActions.setSelectedTool("localization");
      workspaceControllerRef.current?.expand("left");
    }
    window.setTimeout(() => {
      if (issue.componentId && focusInspectorValidationIssue(issue)) {
        return;
      }
      if (!issue.componentId && focusDocumentValidationIssue(issue)) {
        return;
      }
      const fallback = issue.componentId
        ? window.document.querySelector<HTMLElement>(
            "#property-inspector-title"
          )
        : window.document.querySelector<HTMLElement>("#preview-context-title");
      fallback?.scrollIntoView?.({ block: "center" });
      fallback?.focus();
    }, 0);
  }

  function exportDocument() {
    if (!validation.isValid) {
      workspaceControllerRef.current?.expand("diagnostics");
      const [firstIssue] = validation.errors;
      if (firstIssue) {
        navigateToValidationIssue(firstIssue);
      }
      return;
    }

    downloadStudioDocument(
      activeDocument.id,
      serializeDocument(activeDocument)
    );
  }

  function exportRecoveryDocument() {
    recovery.persist(hostedAutosave.conflict ? "conflict" : "unsaved");
    downloadStudioDocument(
      `${activeDocument.id}-recovery`,
      `${JSON.stringify(activeDocument, null, 2)}\n`
    );
  }

  function openPreviewConnections() {
    workspaceControllerRef.current?.expand("diagnostics");
    window.setTimeout(() => {
      const panel = window.document.querySelector<HTMLElement>(
        "#connected-preview-panel"
      );
      panel?.scrollIntoView?.({ block: "nearest" });
      panel?.focus({ preventScroll: true });
    }, 0);
  }

  function runWorkspaceCommand(command: StudioWorkspaceCommand) {
    switch (command) {
      case "expand-left":
        workspaceControllerRef.current?.expand("left");
        break;
      case "toggle-left":
        workspaceControllerRef.current?.toggle("left");
        break;
      case "toggle-properties":
        workspaceControllerRef.current?.toggle("properties");
        break;
      case "toggle-diagnostics":
        workspaceControllerRef.current?.toggle("diagnostics");
        break;
      case "reset":
        workspaceControllerRef.current?.reset();
        break;
      default:
        // Unreachable for StudioWorkspaceCommand: the cases above are the whole
        // union. It stands guard for a command arriving from outside the type,
        // where ignoring it beats acting on a command nobody defined.
        break;
    }
  }

  const validationSummary = validation.isValid
    ? "Validation ready"
    : `${validation.errors.length} validation ${validation.errors.length === 1 ? "issue" : "issues"}`;
  const diagnosticsPanel = (
    <section
      aria-label="Studio diagnostics"
      className="h-full overflow-hidden bg-card"
      data-slot="studio-diagnostics"
    >
      <div className="flex h-8 items-center justify-between gap-3 border-border border-b px-3 text-xs">
        <span className="font-semibold">Diagnostics</span>
        <span className="truncate text-muted-foreground">
          {validationSummary} · Preview clients · {preview.aggregate.total}
        </span>
      </div>
      <div className="h-[calc(100%-2rem)] overflow-y-auto p-4">
        {hostedAutosave.conflict ? (
          <div className="mb-4">
            <HostedDraftConflict
              conflict={hostedAutosave.conflict}
              onExportLocal={exportRecoveryDocument}
              onInspectLatest={() =>
                hostedSession?.fetchLatestDraft() ??
                Promise.reject(new Error("Hosted Draft session unavailable"))
              }
              onReconcile={(latest) => {
                recovery.persist("conflict");
                hostedSession?.acceptSavedDraft(latest);
                hostedAutosave.reconcileWithLatest(latest);
              }}
              onReloadLatest={(latest) => {
                recovery.persist("conflict");
                hostedAutosave.reloadLatest(latest);
                hostedSession?.acceptSavedDraft(latest);
                editor.openHostedDraft(latest.document, latest.id);
              }}
            />
          </div>
        ) : null}
        {/* Non-blocking, and deliberately not tied to the conflict branch: the
            operator's assumption that unsaved work is safe locally is wrong
            from this moment on, whatever else is happening. */}
        {source.kind === "hosted" && recovery.persistenceFailed ? (
          <StatusMessage
            className="mb-4 rounded border border-border bg-muted/35 p-3 text-sm"
            tone="warning"
          >
            <p className="font-semibold">
              Unsaved changes could not be backed up in this browser
            </p>
            <p className="mt-1 text-muted-foreground leading-6">
              Browser storage refused the recovery copy — it may be full,
              disabled, or this document may be too large for it. Your edits are
              still on the canvas and Mosaic keeps trying to save them to the
              server. Download a copy before closing this tab.
            </p>
            <div className="mt-3">
              <Button
                onClick={exportRecoveryDocument}
                size="sm"
                type="button"
                variant="outline"
              >
                Download a copy now
              </Button>
            </div>
          </StatusMessage>
        ) : null}
        {source.kind === "hosted" &&
        recoveryRecord &&
        !hostedAutosave.conflict ? (
          <StatusMessage
            className="mb-4 rounded border border-border bg-muted/35 p-3 text-sm"
            tone="warning"
          >
            <p className="font-semibold">
              A browser recovery copy is available
            </p>
            <p className="mt-1 text-muted-foreground leading-6">
              Mosaic preserved edits from{" "}
              {new Date(recoveryRecord.savedAt).toLocaleString()}. Restore them
              to the canvas or download them before dismissing this copy.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  editor.openHostedDraft(
                    recoveryRecord.document,
                    recoveryRecord.draftId
                  )
                }
                size="sm"
                type="button"
              >
                Restore recovered edits
              </Button>
              <Button
                onClick={() =>
                  downloadStudioDocument(
                    `${recoveryRecord.document.id}-recovery`,
                    serializeHostedRecoveryDocument(recoveryRecord)
                  )
                }
                size="sm"
                type="button"
                variant="outline"
              >
                Download recovery copy
              </Button>
              <Button
                onClick={recovery.clear}
                size="sm"
                type="button"
                variant="ghost"
              >
                Dismiss copy
              </Button>
            </div>
          </StatusMessage>
        ) : null}
        {source.kind === "hosted" && publishReviewOpen ? (
          <div className="mb-4">
            {source.initialReview === "publish" ? (
              <StatusMessage
                className="mb-3 rounded border border-primary/20 bg-primary/5 p-3 text-sm"
                tone="info"
              >
                Returned to Publish review. Mosaic is checking the current Draft
                and Purchase setup again.
              </StatusMessage>
            ) : null}
            <HostedPublishPanel
              environmentId={source.environmentId}
              environmentName={hostedEnvironmentName ?? "Selected Environment"}
              organizationId={source.organizationId}
              paywallId={source.paywallId}
              projectId={source.projectId}
            />
          </div>
        ) : null}
        {importError ? (
          <StatusMessage
            className="mb-4 rounded border border-destructive/25 bg-destructive/5 p-3 text-sm"
            tone="danger"
          >
            <p className="font-semibold">Import was not applied</p>
            <p className="mt-1 text-muted-foreground">{importError}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              Your open paywall is unchanged.
            </p>
          </StatusMessage>
        ) : null}
        {importNotices && importNotices.length > 0 ? (
          <StatusMessage
            className="mb-4 rounded border border-border bg-muted/35 p-3 text-sm"
            tone="warning"
          >
            <p className="font-semibold">Import applied with changes</p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {importNotices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </StatusMessage>
        ) : null}
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <ValidationPanel
            issues={validation.issues}
            onNavigate={navigateToValidationIssue}
          />
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
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-studio-mode={source.kind}
      data-testid="studio-editor-shell"
    >
      <StudioToolbar
        autosave={autosave}
        backHref={
          source.kind === "hosted" ? hostedStudioBackHref(source) : "/workspace"
        }
        backLabel={source.kind === "hosted" ? "Paywall" : "Workspace"}
        canRedo={canRedo}
        canUndo={canUndo}
        documentIdentity={document.id}
        environmentLabel={
          source.kind === "hosted"
            ? `Environment · ${hostedEnvironmentName}`
            : undefined
        }
        mode={source.kind}
        onBack={
          source.kind === "hosted" ? recovery.prepareNavigation : autosave.flush
        }
        onConnectHosted={source.kind === "local" ? autosave.flush : undefined}
        onExport={exportDocument}
        onOpenPreviewConnections={openPreviewConnections}
        onPublish={
          source.kind === "hosted"
            ? () => {
                setPublishReviewOpen(true);
                workspaceControllerRef.current?.expand("diagnostics");
              }
            : undefined
        }
        onRedo={redo}
        onRequestImport={() => importInputRef.current?.click()}
        onUndo={undo}
        previewClientCount={preview.aggregate.total}
        previewSummary={preview.aggregate.label}
        publishDisabled={
          !validation.isValid ||
          ["conflict", "failed", "offline", "saving", "unsaved"].includes(
            autosave.status
          )
        }
      />
      <input
        accept="application/json,.json"
        aria-label="Import Mosaic JSON file"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onImport(file);
          }
          event.target.value = "";
        }}
        ref={importInputRef}
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
          canvas={
            <section
              aria-labelledby="studio-canvas-title"
              className="h-full min-h-0 overflow-hidden"
            >
              <h2 className="sr-only" id="studio-canvas-title">
                Paywall canvas
              </h2>
              <PreviewCanvas
                mockProducts={mockProducts}
                mockPurchaseState={mockPurchaseState}
              />
            </section>
          }
          desktopRequiredContent={
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm leading-6">
                Your single local draft remains in this browser. You can still
                export a valid copy before moving to a larger display.
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
          onOpenCommands={() => setCommandPaletteOpen(true)}
          propertiesPanel={
            <aside
              aria-label="Component properties"
              className="scrollbar-thin scrollbar-gutter-stable h-full overflow-y-auto bg-card p-4"
            >
              <PropertyInspector issues={validation.issues} />
            </aside>
          }
          ref={workspaceControllerRef}
          viewportMode={viewportMode}
        />
      </div>
    </div>
  );
}
