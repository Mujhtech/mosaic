import type { UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { buttonVariants } from "@/components/ui/button-variants";
import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner";
import { EditorShell } from "@/features/paywall-editor/components/editor-shell";
import { TemplateSelection } from "@/features/paywall-editor/components/template-selection";
import {
  DEFAULT_MOCK_PRODUCTS,
  MAX_LOCAL_PROJECT_BYTES,
} from "@/features/paywall-editor/constants/editor-constants";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import {
  resolveRestoredPreviewContext,
  useWorkspacePreviewContext,
} from "@/features/paywall-editor/hooks/use-workspace-preview-context";
import {
  type LocalProjectReadResult,
  parseImportedJson,
  readLocalMockPurchaseState,
  readLocalProjectResult,
  reconcileMockProductsForDocument,
  reconcileMockPurchaseState,
  unavailableMockProductsForDocument,
} from "@/features/paywall-editor/mutations/local-project-file";
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context";
import { StudioSourceProvider } from "@/features/paywall-editor/stores/studio-source-context";
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store";
import {
  StudioWorkspaceStoreProvider,
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context";
import { useStudioSource } from "@/features/paywall-editor/stores/use-studio-source";
import type {
  LocalProjectFile,
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor";
import {
  hostedStudioBackHref,
  hostedStudioHref,
  LOCAL_STUDIO_SOURCE,
  type StudioSource,
} from "@/features/paywall-editor/types/studio-source";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { hostedDraftQueryOptions } from "@/features/paywalls/queries/paywall-queries";
import { HostedDraftSessionProvider } from "@/features/paywalls/stores/hosted-draft-session-context";
import type { HostedDraft } from "@/features/publishing/api/hosted-publishing-adapter";
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter";
import { HostedContractPending } from "@/features/publishing/components/hosted-contract-pending";
import { ApiError } from "@/lib/api/errors";

const selectWorkspaceCanvas = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.canvas;
const selectWorkspaceSource = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.initialSource;

function presetForProject(project: LocalProjectFile): MockPurchaseState {
  if (
    project.mockCommerce.state.products.every(
      (product) => product.availability === "unavailable"
    )
  ) {
    return "productUnavailable";
  }
  switch (project.mockCommerce.state.purchaseOutcome) {
    case "alreadyEntitled":
      return "alreadyEntitled";
    case "cancelled":
      return "purchaseCancellation";
    case "purchaseFailed":
      return "purchaseFailure";
    case "purchased":
      return project.mockCommerce.state.restoreOutcome === "restored"
        ? "restoreSuccess"
        : project.mockCommerce.state.restoreOutcome === "restoreFailed"
          ? "restoreFailure"
          : "purchaseSuccess";
    default: {
      const unhandled: never = project.mockCommerce.state.purchaseOutcome;
      throw new Error(
        `Unhandled project.mockCommerce.state.purchaseOutcome: ${JSON.stringify(unhandled)}`
      );
    }
  }
}

interface WorkspaceContentProps {
  readonly hostedContractPending?: boolean;
  readonly hostedDraft?: UseQueryResult<HostedDraft, Error>;
}

function HostedStudioLoadError({
  error,
  onRetry,
  source,
}: {
  error: Error;
  onRetry: () => void;
  source: Extract<StudioSource, { kind: "hosted" }>;
}) {
  const returnTo = hostedStudioHref(source);

  if (error instanceof ApiError && error.status === 401) {
    return <HostedAccessBanner returnTo={returnTo} />;
  }

  if (error instanceof ApiError && error.status === 403) {
    return (
      <section
        aria-labelledby="hosted-studio-permission-title"
        className="rounded border border-border bg-muted/30 p-6"
      >
        <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          Permission required
        </p>
        <h1
          className="mt-2 font-semibold text-lg"
          id="hosted-studio-permission-title"
        >
          This hosted Draft is not available to your account
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
          Ask a Project owner for access, return to the Paywall, or sign in with
          an account that has access. Local Studio remains available.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link className={buttonVariants()} search={{ returnTo }} to="/login">
            Sign in with another account
          </Link>
          <a
            className={buttonVariants({ variant: "outline" })}
            href={hostedStudioBackHref(source)}
          >
            Return to Paywall
          </a>
          <Link className={buttonVariants({ variant: "ghost" })} to="/studio">
            Continue locally
          </Link>
        </div>
      </section>
    );
  }

  return (
    <ErrorState
      description={error.message}
      onRetry={onRetry}
      title="Hosted Draft unavailable"
    />
  );
}

function WorkspaceContent({
  hostedContractPending,
  hostedDraft,
}: WorkspaceContentProps) {
  const source = useStudioSource();
  const { document, editableDocumentId } = useEditorStore();
  const {
    loadTemplate,
    openHostedDraft,
    replaceDocument,
    restoreProject,
    importDocument,
  } = useEditorActions();
  const workspaceCanvas = useStudioWorkspaceSelector(selectWorkspaceCanvas);
  const workspaceSource = useStudioWorkspaceSelector(selectWorkspaceSource);
  const workspace = useStudioWorkspaceActions();
  const [autosave, setAutosave] = useState<LocalProjectReadResult>({
    status: "empty",
  });
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<MosaicDocument | null>(
    null
  );
  const [mockProducts, setMockProducts] = useState<MockProductDefinition[]>(
    () =>
      hostedDraft?.data
        ? unavailableMockProductsForDocument(hostedDraft.data.document)
        : cloneValue([...DEFAULT_MOCK_PRODUCTS])
  );
  const [mockPurchaseState, setMockPurchaseState] = useState<MockPurchaseState>(
    () => (hostedDraft?.data ? "productUnavailable" : "productAvailable")
  );
  const activeMockProducts = useMemo(
    () =>
      document
        ? reconcileMockProductsForDocument(document, mockProducts)
        : mockProducts,
    [document, mockProducts]
  );
  const activeMockPurchaseState = reconcileMockPurchaseState(
    mockPurchaseState,
    activeMockProducts
  );
  const hostedDraftData = hostedDraft?.data;
  useWorkspacePreviewContext();

  useEffect(() => {
    if (source.kind !== "local") {
      return;
    }
    const timer = window.setTimeout(
      () => setAutosave(readLocalProjectResult()),
      0
    );
    return () => window.clearTimeout(timer);
  }, [source.kind]);

  useEffect(() => {
    if (
      source.kind !== "hosted" ||
      !hostedDraftData ||
      editableDocumentId === hostedDraftData.id
    ) {
      return;
    }
    openHostedDraft(hostedDraftData.document, hostedDraftData.id);
  }, [editableDocumentId, hostedDraftData, openHostedDraft, source.kind]);

  const applyProject = useCallback(
    (project: LocalProjectFile) => {
      const preview = resolveRestoredPreviewContext({
        document: project.document,
        localProjectPreview: project.preview,
        workspaceCanvas,
        workspaceSource,
      });
      workspace.setCanvasPreferences({
        ...workspaceCanvas,
        locale: preview.locale,
        textScale: preview.textScale,
      });
      restoreProject(
        project.document,
        project.editableDocumentId,
        project.revision.sequence,
        preview.locale,
        preview.textScale
      );
      setMockProducts(cloneValue(project.mockCommerce.state.products));
      setMockPurchaseState(
        readLocalMockPurchaseState(project) ?? presetForProject(project)
      );
    },
    [restoreProject, workspace, workspaceCanvas, workspaceSource]
  );

  const handleResume = useCallback(() => {
    if (autosave.status === "valid" || autosave.status === "recoverable") {
      applyProject(autosave.project);
    }
  }, [applyProject, autosave]);
  function applyImportedDocument(next: MosaicDocument) {
    if (document) {
      importDocument(next);
    } else {
      replaceDocument(next);
    }
    setMockProducts(unavailableMockProductsForDocument(next));
    setMockPurchaseState("productUnavailable");
    setImportError(null);
    setPendingImport(null);
  }

  async function importFile(file: File) {
    try {
      if (file.size > MAX_LOCAL_PROJECT_BYTES) {
        throw new Error("Choose a Mosaic file under 1 MB.");
      }
      const imported = parseImportedJson(await file.text());
      if (document) {
        setPendingImport(imported.document);
        return;
      }
      applyImportedDocument(imported.document);
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "The file could not be imported."
      );
    }
  }

  if (!document) {
    if (source.kind === "hosted") {
      if (hostedContractPending) {
        return (
          <div className="mx-auto w-full max-w-3xl p-6 sm:p-10">
            <HostedContractPending />
          </div>
        );
      }
      if (hostedDraft?.error) {
        return (
          <div className="mx-auto w-full max-w-3xl p-6 sm:p-10">
            <HostedStudioLoadError
              error={hostedDraft.error}
              onRetry={() => {
                hostedDraft.refetch();
              }}
              source={source}
            />
          </div>
        );
      }
      return (
        <div className="mx-auto w-full max-w-3xl p-6 sm:p-10">
          <LoadingState description="Loading the latest hosted Draft revision." />
        </div>
      );
    }
    return (
      <TemplateSelection
        autosave={autosave}
        importError={importError}
        onImport={importFile}
        onResume={handleResume}
        onSelectTemplate={(templateId) => {
          const template = EDITOR_TEMPLATES.find(
            (entry) => entry.id === templateId
          );
          if (template) {
            loadTemplate(template.document);
          }
        }}
      />
    );
  }

  return (
    <>
      <EditorShell
        importError={importError}
        mockProducts={activeMockProducts}
        mockPurchaseState={activeMockPurchaseState}
        onImport={importFile}
        onProductsChange={setMockProducts}
        onPurchaseStateChange={setMockPurchaseState}
      />
      <ConfirmDialog
        confirmLabel="Replace paywall"
        description="Replace the open paywall with this file? You can undo once after import to restore the current paywall."
        onConfirm={() => {
          if (pendingImport) {
            applyImportedDocument(pendingImport);
          }
        }}
        onOpenChange={(next) => {
          if (!next) {
            setPendingImport(null);
          }
        }}
        open={pendingImport !== null}
        title="Replace the open paywall"
      />
    </>
  );
}

function HostedWorkspaceContent({
  source,
}: {
  source: Extract<StudioSource, { kind: "hosted" }>;
}) {
  const adapter = useHostedPublishingAdapter();
  const hostedDraft = useQuery({
    ...hostedDraftQueryOptions(
      {
        draftId: source.draftId,
        paywallId: source.paywallId,
        projectId: source.projectId,
      },
      adapter
    ),
    enabled: adapter.status === "available",
  });

  return hostedDraft.data ? (
    <HostedDraftSessionProvider
      adapter={adapter}
      draft={hostedDraft.data}
      key={hostedDraft.data.id}
    >
      <WorkspaceContent hostedDraft={hostedDraft} />
    </HostedDraftSessionProvider>
  ) : (
    <WorkspaceContent
      hostedContractPending={adapter.status === "contract_pending"}
      hostedDraft={hostedDraft}
    />
  );
}

function RoutedWorkspaceContent() {
  const source = useStudioSource();
  return source.kind === "hosted" ? (
    <HostedWorkspaceContent source={source} />
  ) : (
    <WorkspaceContent />
  );
}

export function PaywallEditorProviders({
  children,
  source = LOCAL_STUDIO_SOURCE,
}: {
  children: ReactNode;
  source?: StudioSource;
}) {
  return (
    <StudioSourceProvider source={source}>
      <StudioWorkspaceStoreProvider>
        <EditorStoreProvider>{children}</EditorStoreProvider>
      </StudioWorkspaceStoreProvider>
    </StudioSourceProvider>
  );
}

export function PaywallEditorWorkspace({
  source = LOCAL_STUDIO_SOURCE,
}: {
  source?: StudioSource;
}) {
  return (
    <PaywallEditorProviders source={source}>
      <RoutedWorkspaceContent />
    </PaywallEditorProviders>
  );
}
