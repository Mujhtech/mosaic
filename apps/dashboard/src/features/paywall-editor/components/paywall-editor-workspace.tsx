import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { ErrorState } from "@/components/feedback/error-state"
import { LoadingState } from "@/components/feedback/loading-state"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner"
import { EditorShell } from "@/features/paywall-editor/components/editor-shell"
import { TemplateSelection } from "@/features/paywall-editor/components/template-selection"
import { DEFAULT_MOCK_PRODUCTS } from "@/features/paywall-editor/constants/editor-constants"
import { MAX_LOCAL_PROJECT_BYTES } from "@/features/paywall-editor/constants/editor-constants"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  resolveRestoredPreviewContext,
  useWorkspacePreviewContext,
} from "@/features/paywall-editor/hooks/use-workspace-preview-context"
import {
  parseImportedJson,
  readLocalMockPurchaseState,
  readLocalProjectResult,
  reconcileMockPurchaseState,
  reconcileMockProductsForDocument,
  type LocalProjectReadResult,
  unavailableMockProductsForDocument,
} from "@/features/paywall-editor/mutations/local-project-file"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import { StudioSourceProvider } from "@/features/paywall-editor/stores/studio-source-context"
import { useStudioSource } from "@/features/paywall-editor/stores/use-studio-source"
import {
  StudioWorkspaceStoreProvider,
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import type {
  LocalProjectFile,
  MockProductDefinition,
  MockPurchaseState,
} from "@/features/paywall-editor/types/editor"
import {
  hostedStudioBackHref,
  hostedStudioHref,
  LOCAL_STUDIO_SOURCE,
  type StudioSource,
} from "@/features/paywall-editor/types/studio-source"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { hostedDraftQueryOptions } from "@/features/paywalls/queries/paywall-queries"
import { HostedDraftSessionProvider } from "@/features/paywalls/stores/hosted-draft-session-context"
import { HostedContractPending } from "@/features/publishing/components/hosted-contract-pending"
import type { HostedDraft } from "@/features/publishing/api/hosted-publishing-adapter"
import { useHostedPublishingAdapter } from "@/features/publishing/api/use-hosted-publishing-adapter"
import { ApiError } from "@/lib/api/errors"

const selectWorkspaceCanvas = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.canvas
const selectWorkspaceSource = (snapshot: StudioWorkspaceSnapshot) => snapshot.initialSource

function presetForProject(project: LocalProjectFile): MockPurchaseState {
  if (
    project.mockCommerce.state.products.every((product) => product.availability === "unavailable")
  ) {
    return "productUnavailable"
  }
  switch (project.mockCommerce.state.purchaseOutcome) {
    case "alreadyEntitled":
      return "alreadyEntitled"
    case "cancelled":
      return "purchaseCancellation"
    case "purchaseFailed":
      return "purchaseFailure"
    case "purchased":
      return project.mockCommerce.state.restoreOutcome === "restored"
        ? "restoreSuccess"
        : project.mockCommerce.state.restoreOutcome === "restoreFailed"
          ? "restoreFailure"
          : "purchaseSuccess"
  }
}

interface WorkspaceContentProps {
  readonly hostedDraft?: UseQueryResult<HostedDraft, Error>
  readonly hostedContractPending?: boolean
}

function HostedStudioLoadError({
  error,
  onRetry,
  source,
}: {
  error: Error
  onRetry: () => void
  source: Extract<StudioSource, { kind: "hosted" }>
}) {
  const returnTo = hostedStudioHref(source)

  if (error instanceof ApiError && error.status === 401) {
    return <HostedAccessBanner returnTo={returnTo} />
  }

  if (error instanceof ApiError && error.status === 403) {
    return (
      <section
        aria-labelledby="hosted-studio-permission-title"
        className="border-border bg-muted/30 rounded border p-6"
      >
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Permission required
        </p>
        <h1 className="mt-2 text-lg font-semibold" id="hosted-studio-permission-title">
          This hosted Draft is not available to your account
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
          Ask a Project owner for access, return to the Paywall, or sign in with an account that has
          access. Local Studio remains available.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link className={buttonVariants()} search={{ returnTo }} to="/login">
            Sign in with another account
          </Link>
          <a className={buttonVariants({ variant: "outline" })} href={hostedStudioBackHref(source)}>
            Return to Paywall
          </a>
          <Link className={buttonVariants({ variant: "ghost" })} to="/studio">
            Continue locally
          </Link>
        </div>
      </section>
    )
  }

  return (
    <ErrorState description={error.message} onRetry={onRetry} title="Hosted Draft unavailable" />
  )
}

function WorkspaceContent({ hostedContractPending, hostedDraft }: WorkspaceContentProps) {
  const source = useStudioSource()
  const { document, editableDocumentId } = useEditorStore()
  const { loadTemplate, openHostedDraft, replaceDocument, restoreProject, importDocument } =
    useEditorActions()
  const workspaceCanvas = useStudioWorkspaceSelector(selectWorkspaceCanvas)
  const workspaceSource = useStudioWorkspaceSelector(selectWorkspaceSource)
  const workspace = useStudioWorkspaceActions()
  const [autosave, setAutosave] = useState<LocalProjectReadResult>({ status: "empty" })
  const [importError, setImportError] = useState<string | null>(null)
  const [mockProducts, setMockProducts] = useState<MockProductDefinition[]>(() =>
    hostedDraft?.data
      ? unavailableMockProductsForDocument(hostedDraft.data.document)
      : cloneValue([...DEFAULT_MOCK_PRODUCTS]),
  )
  const [mockPurchaseState, setMockPurchaseState] = useState<MockPurchaseState>(() =>
    hostedDraft?.data ? "productUnavailable" : "productAvailable",
  )
  const activeMockProducts = useMemo(
    () => (document ? reconcileMockProductsForDocument(document, mockProducts) : mockProducts),
    [document, mockProducts],
  )
  const activeMockPurchaseState = reconcileMockPurchaseState(mockPurchaseState, activeMockProducts)
  const hostedDraftData = hostedDraft?.data
  useWorkspacePreviewContext()

  useEffect(() => {
    if (source.kind !== "local") return
    const timer = window.setTimeout(() => setAutosave(readLocalProjectResult()), 0)
    return () => window.clearTimeout(timer)
  }, [source.kind])

  useEffect(() => {
    if (source.kind !== "hosted" || !hostedDraftData || editableDocumentId === hostedDraftData.id) {
      return
    }
    openHostedDraft(hostedDraftData.document, hostedDraftData.id)
  }, [editableDocumentId, hostedDraftData, openHostedDraft, source.kind])

  function applyProject(project: LocalProjectFile) {
    const preview = resolveRestoredPreviewContext({
      document: project.document,
      localProjectPreview: project.preview,
      workspaceCanvas,
      workspaceSource,
    })
    workspace.setCanvasPreferences({
      ...workspaceCanvas,
      locale: preview.locale,
      textScale: preview.textScale,
    })
    restoreProject(
      project.document,
      project.editableDocumentId,
      project.revision.sequence,
      preview.locale,
      preview.textScale,
    )
    setMockProducts(cloneValue(project.mockCommerce.state.products))
    setMockPurchaseState(readLocalMockPurchaseState(project) ?? presetForProject(project))
  }

  async function importFile(file: File) {
    try {
      if (file.size > MAX_LOCAL_PROJECT_BYTES) {
        throw new Error("Choose a Mosaic file under 1 MB.")
      }
      const imported = parseImportedJson(await file.text())
      if (
        document &&
        !window.confirm(
          "Replace the open paywall with this file? You can undo once after import to restore the current paywall.",
        )
      ) {
        return
      }
      if (document) {
        importDocument(imported.document)
      } else replaceDocument(imported.document)
      setMockProducts(unavailableMockProductsForDocument(imported.document))
      setMockPurchaseState("productUnavailable")
      setImportError(null)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The file could not be imported.")
    }
  }

  if (!document) {
    if (source.kind === "hosted") {
      if (hostedContractPending) {
        return (
          <div className="mx-auto w-full max-w-3xl p-6 sm:p-10">
            <HostedContractPending />
          </div>
        )
      }
      if (hostedDraft?.error) {
        return (
          <div className="mx-auto w-full max-w-3xl p-6 sm:p-10">
            <HostedStudioLoadError
              error={hostedDraft.error}
              onRetry={() => void hostedDraft.refetch()}
              source={source}
            />
          </div>
        )
      }
      return (
        <div className="mx-auto w-full max-w-3xl p-6 sm:p-10">
          <LoadingState description="Loading the latest hosted Draft revision." />
        </div>
      )
    }
    return (
      <TemplateSelection
        autosave={autosave}
        importError={importError}
        onSelectTemplate={(templateId) => {
          const template = EDITOR_TEMPLATES.find((entry) => entry.id === templateId)
          if (template) loadTemplate(template.document)
        }}
        onResume={() => {
          if (autosave.status === "valid" || autosave.status === "recoverable") {
            applyProject(autosave.project)
          }
        }}
        onImport={importFile}
      />
    )
  }

  return (
    <EditorShell
      mockProducts={activeMockProducts}
      mockPurchaseState={activeMockPurchaseState}
      importError={importError}
      onProductsChange={setMockProducts}
      onPurchaseStateChange={setMockPurchaseState}
      onImport={importFile}
    />
  )
}

function HostedWorkspaceContent({ source }: { source: Extract<StudioSource, { kind: "hosted" }> }) {
  const adapter = useHostedPublishingAdapter()
  const hostedDraft = useQuery({
    ...hostedDraftQueryOptions(
      { draftId: source.draftId, paywallId: source.paywallId, projectId: source.projectId },
      adapter,
    ),
    enabled: adapter.status === "available",
  })

  return hostedDraft.data ? (
    <HostedDraftSessionProvider
      key={hostedDraft.data.id}
      adapter={adapter}
      draft={hostedDraft.data}
    >
      <WorkspaceContent hostedDraft={hostedDraft} />
    </HostedDraftSessionProvider>
  ) : (
    <WorkspaceContent
      hostedContractPending={adapter.status === "contract_pending"}
      hostedDraft={hostedDraft}
    />
  )
}

function RoutedWorkspaceContent() {
  const source = useStudioSource()
  return source.kind === "hosted" ? (
    <HostedWorkspaceContent source={source} />
  ) : (
    <WorkspaceContent />
  )
}

export function PaywallEditorProviders({
  children,
  source = LOCAL_STUDIO_SOURCE,
}: {
  children: ReactNode
  source?: StudioSource
}) {
  return (
    <StudioSourceProvider source={source}>
      <StudioWorkspaceStoreProvider>
        <EditorStoreProvider>{children}</EditorStoreProvider>
      </StudioWorkspaceStoreProvider>
    </StudioSourceProvider>
  )
}

export function PaywallEditorWorkspace({
  source = LOCAL_STUDIO_SOURCE,
}: {
  source?: StudioSource
}) {
  return (
    <PaywallEditorProviders source={source}>
      <RoutedWorkspaceContent />
    </PaywallEditorProviders>
  )
}
