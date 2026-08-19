import { StatusMessage } from "@mosaic/design-system";
import { LocalDateTime } from "@/components/feedback/local-date-time";

import { Button } from "@/components/ui/button";
import { downloadStudioDocument } from "@/features/paywall-editor/components/editor-shell-support";
import { PreviewConnectionPanel } from "@/features/paywall-editor/components/preview-connection-panel";
import { ValidationPanel } from "@/features/paywall-editor/components/validation-panel";
import type { useEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation";
import type { usePreviewConnection } from "@/features/paywall-editor/hooks/use-preview-connection";
import type { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type { useStudioSource } from "@/features/paywall-editor/stores/use-studio-source";
import type {
  MosaicDocument,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor";
import { HostedDraftConflict } from "@/features/paywalls/components/hosted-draft-conflict";
import type { HostedDraftAutosaveController } from "@/features/paywalls/hooks/use-hosted-draft-autosave";
import type { useHostedDraftRecovery } from "@/features/paywalls/hooks/use-hosted-draft-recovery";
import { serializeHostedRecoveryDocument } from "@/features/paywalls/mutations/hosted-draft-recovery";
import type { useHostedDraftSession } from "@/features/paywalls/stores/use-hosted-draft-session";
import { HostedPublishPanel } from "@/features/publishing/components/hosted-publish-panel";

type StudioSource = ReturnType<typeof useStudioSource>;
type HostedDraftRecovery = ReturnType<typeof useHostedDraftRecovery>;
type EditorValidation = ReturnType<typeof useEditorValidation>;
type PreviewConnection = ReturnType<typeof usePreviewConnection>;

export function StudioDiagnosticsPanel({
  document,
  editor,
  hostedAutosave,
  hostedEnvironmentName,
  hostedSession,
  importError,
  importNotices,
  onNavigateToValidationIssue,
  preview,
  publishReviewOpen,
  recovery,
  source,
  validation,
}: {
  document: MosaicDocument;
  editor: ReturnType<typeof useEditorActions>;
  hostedAutosave: HostedDraftAutosaveController;
  hostedEnvironmentName: string | undefined;
  hostedSession: ReturnType<typeof useHostedDraftSession>;
  importError: string | null;
  importNotices?: readonly string[];
  onNavigateToValidationIssue: (issue: ValidationIssue) => void;
  preview: PreviewConnection;
  publishReviewOpen: boolean;
  recovery: HostedDraftRecovery;
  source: StudioSource;
  validation: EditorValidation;
}) {
  // Bound to a const so the render guard below narrows inside the button
  // callbacks too: a property read would widen again at each call site.
  const recoveryRecord = recovery.record;
  const validationSummary = validation.isValid
    ? "Validation ready"
    : `${validation.errors.length} validation ${validation.errors.length === 1 ? "issue" : "issues"}`;

  function exportRecoveryDocument() {
    recovery.persist(hostedAutosave.conflict ? "conflict" : "unsaved");
    downloadStudioDocument(
      `${document.id}-recovery`,
      `${JSON.stringify(document, null, 2)}\n`
    );
  }

  return (
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
              <LocalDateTime value={recoveryRecord.savedAt} />. Restore them to
              the canvas or download them before dismissing this copy.
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
            onNavigate={onNavigateToValidationIssue}
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
}
