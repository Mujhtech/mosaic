import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import {
  lazy,
  type ReactNode,
  type RefObject,
  Suspense,
  useCallback,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  downloadStudioDocument,
  navigateToStudioValidationIssue,
  openStudioPreviewConnections,
  runStudioWorkspaceCommand,
} from "@/features/paywall-editor/components/editor-shell-support";
import { PreviewCanvas } from "@/features/paywall-editor/components/preview-canvas";
import { PropertyInspector } from "@/features/paywall-editor/components/property-inspector";
import { StudioDiagnosticsPanel } from "@/features/paywall-editor/components/studio-diagnostics-panel";
import {
  StudioResizableWorkspace,
  type StudioResizableWorkspaceHandle,
} from "@/features/paywall-editor/components/studio-resizable-workspace";
import { StudioToolPanel } from "@/features/paywall-editor/components/studio-tool-panel";
import { StudioToolbar } from "@/features/paywall-editor/components/studio-toolbar";
import { useDraftAutosaveController } from "@/features/paywall-editor/hooks/use-draft-autosave";
import { useEditorHistory } from "@/features/paywall-editor/hooks/use-editor-history";
import { useEditorKeyboardShortcuts } from "@/features/paywall-editor/hooks/use-editor-keyboard-shortcuts";
import { useEditorSelection } from "@/features/paywall-editor/hooks/use-editor-selection";
import { useEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation";
import { usePreviewConnection } from "@/features/paywall-editor/hooks/use-preview-connection";
import {
  type StudioViewportMode,
  useStudioViewportMode,
} from "@/features/paywall-editor/hooks/use-studio-viewport-mode";
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
  MosaicDocument,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor";
import { hostedStudioBackHref } from "@/features/paywall-editor/types/studio-source";
import { useHostedDraftAutosave } from "@/features/paywalls/hooks/use-hosted-draft-autosave";
import { useHostedDraftRecovery } from "@/features/paywalls/hooks/use-hosted-draft-recovery";
import { useHostedDraftSession } from "@/features/paywalls/stores/use-hosted-draft-session";

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
    navigateToStudioValidationIssue(issue, {
      selectComponent,
      workspace: workspaceControllerRef.current,
      workspaceActions,
    });
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
        onOpenPreviewConnections={() =>
          openStudioPreviewConnections(workspaceControllerRef.current)
        }
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
            onWorkspaceCommand={(command) =>
              runStudioWorkspaceCommand(workspaceControllerRef.current, command)
            }
            open
          />
        </Suspense>
      ) : null}

      <StudioWorkspaceRegion
        assets={activeDocument.assets}
        diagnosticsPanel={
          <StudioDiagnosticsPanel
            document={activeDocument}
            editor={editor}
            hostedAutosave={hostedAutosave}
            hostedEnvironmentName={hostedEnvironmentName}
            hostedSession={hostedSession}
            importError={importError}
            importNotices={importNotices}
            onNavigateToValidationIssue={navigateToValidationIssue}
            preview={preview}
            publishReviewOpen={publishReviewOpen}
            recovery={recovery}
            source={source}
            validation={validation}
          />
        }
        issues={validation.issues}
        isValid={validation.isValid}
        mockProducts={mockProducts}
        mockPurchaseState={mockPurchaseState}
        onExport={exportDocument}
        onOpenCommands={() => setCommandPaletteOpen(true)}
        onProductsChange={onProductsChange}
        onPurchaseStateChange={onPurchaseStateChange}
        previewClients={preview.clients}
        viewportMode={viewportMode}
        workspaceControllerRef={workspaceControllerRef}
      />
    </div>
  );
}

function StudioWorkspaceRegion({
  assets,
  diagnosticsPanel,
  isValid,
  issues,
  mockProducts,
  mockPurchaseState,
  onExport,
  onOpenCommands,
  onProductsChange,
  onPurchaseStateChange,
  previewClients,
  viewportMode,
  workspaceControllerRef,
}: {
  assets: MosaicDocument["assets"];
  diagnosticsPanel: ReactNode;
  isValid: boolean;
  issues: readonly ValidationIssue[];
  mockProducts: readonly MockProductDefinition[];
  mockPurchaseState: MockPurchaseState;
  onExport: () => void;
  onOpenCommands: () => void;
  onProductsChange: (products: MockProductDefinition[]) => void;
  onPurchaseStateChange: (state: MockPurchaseState) => void;
  previewClients: ReturnType<typeof usePreviewConnection>["clients"];
  viewportMode: StudioViewportMode;
  workspaceControllerRef: RefObject<StudioResizableWorkspaceHandle | null>;
}) {
  return (
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
              onClick={onExport}
              title={
                isValid
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
            assets={assets}
            mockProducts={mockProducts}
            mockPurchaseState={mockPurchaseState}
            onProductsChange={onProductsChange}
            onPurchaseStateChange={onPurchaseStateChange}
            previewClients={previewClients}
            viewportMode={viewportMode}
            workspaceControllerRef={workspaceControllerRef}
          />
        }
        onOpenCommands={onOpenCommands}
        propertiesPanel={
          <aside
            aria-label="Component properties"
            className="scrollbar-thin scrollbar-gutter-stable h-full overflow-y-auto bg-card p-4"
          >
            <PropertyInspector issues={issues} />
          </aside>
        }
        ref={workspaceControllerRef}
        viewportMode={viewportMode}
      />
    </div>
  );
}
