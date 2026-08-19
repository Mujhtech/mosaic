import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type ComponentProps, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import {
  entitlementsQueryOptions,
  productsQueryOptions,
  providerMappingsQueryOptions,
} from "@/features/catalog/queries/catalog-query";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import {
  applicationsQueryOptions,
  projectQueryOptions,
} from "@/features/projects/queries/projects-query";
import { ProviderCatalogImport } from "@/features/provider-connections/components/provider-catalog-import";
import { ProviderCredentialSheet } from "@/features/provider-connections/components/provider-credential-sheet";
import {
  enqueueProviderSyncMutationOptions,
  importProviderProductsMutationOptions,
  replaceProviderCredentialMutationOptions,
  revokeProviderConnectionMutationOptions,
  testProviderConnectionMutationOptions,
} from "@/features/provider-connections/mutations/provider-connection-mutations";
import {
  providerCatalogPreviewQueryOptions,
  providerConnectionCapabilitiesQueryOptions,
  providerConnectionDiagnosticsQueryOptions,
  providerConnectionHealthQueryOptions,
  providerConnectionQueryOptions,
  providerSyncRunsQueryOptions,
} from "@/features/provider-connections/queries/provider-connection-queries";
import type { ProviderCatalogPreviewView } from "@/features/provider-connections/types/provider-catalog-import";
import {
  providerConnectionLabel,
  providerCredentialActions,
} from "@/features/provider-connections/types/provider-connection-view";
import { environmentMatchesConnectionMode } from "@/features/provider-connections/types/provider-operation-input";
import type {
  Application,
  Entitlement,
  Environment,
  Product,
  ProviderConnection,
  ProviderConnectionCapabilities,
  ProviderDiagnostic,
  ProviderSyncJob,
  ProviderSyncRun,
} from "@/generated/api";

export function ProviderConnectionDetailPage({
  connectionId,
  organizationId,
  projectId,
}: {
  connectionId: string;
  organizationId: string;
  projectId: string;
}) {
  const handleClick7 = useCallback(() => setCatalogRequested(true), []);
  const handleClick5 = useCallback(() => setConfirmRevoke(false), []);
  const handleClick3 = useCallback(() => setConfirmRevoke(true), []);
  const queryClient = useQueryClient();
  const [catalogRequested, setCatalogRequested] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const project = useQuery(projectQueryOptions(projectId));
  const connection = useQuery(providerConnectionQueryOptions(connectionId));
  const scopeMismatch =
    project.isSuccess &&
    connection.isSuccess &&
    (project.data.organizationId !== organizationId ||
      connection.data.projectId !== projectId);
  const scopeReady =
    project.data?.organizationId === organizationId &&
    connection.data?.projectId === projectId;
  const health = useQuery({
    ...providerConnectionHealthQueryOptions(connectionId),
    enabled: scopeReady,
  });
  const capabilities = useQuery({
    ...providerConnectionCapabilitiesQueryOptions(connectionId),
    enabled: scopeReady,
  });
  const diagnostics = useQuery({
    ...providerConnectionDiagnosticsQueryOptions(connectionId),
    enabled: scopeReady,
  });
  const syncRuns = useQuery({
    ...providerSyncRunsQueryOptions(connectionId),
    enabled: scopeReady,
  });
  const handleClick6 = useCallback(() => {
    syncRuns.refetch();
  }, [syncRuns]);
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const products = useQuery({
    ...productsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const entitlements = useQuery({
    ...entitlementsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const mappingQueries = useQueries({
    queries: (products.data?.items ?? []).map((product) => ({
      ...providerMappingsQueryOptions(product.id),
      enabled: scopeReady,
    })),
  });
  const catalog = useQuery({
    ...providerCatalogPreviewQueryOptions(connectionId),
    enabled:
      scopeReady && catalogRequested && connection.data?.status !== "revoked",
  });
  const testConnection = useMutation(
    testProviderConnectionMutationOptions(connectionId, projectId, queryClient)
  );
  const handleClick = useCallback(
    () => testConnection.mutate(),
    [testConnection]
  );
  const rotate = useMutation(
    replaceProviderCredentialMutationOptions(
      "rotate",
      connectionId,
      projectId,
      queryClient
    )
  );
  const reconnect = useMutation(
    replaceProviderCredentialMutationOptions(
      "reconnect",
      connectionId,
      projectId,
      queryClient
    )
  );
  const revoke = useMutation(
    revokeProviderConnectionMutationOptions(
      connectionId,
      projectId,
      queryClient
    )
  );
  const handleClick4 = useCallback(
    () =>
      revoke.mutate(undefined, {
        onSuccess: () => setConfirmRevoke(false),
      }),
    [revoke]
  );
  const sync = useMutation(
    enqueueProviderSyncMutationOptions(connectionId, projectId, queryClient)
  );
  const handleClick2 = useCallback(() => sync.mutate(), [sync]);
  const importProducts = useMutation(
    importProviderProductsMutationOptions(connectionId, projectId, queryClient)
  );
  const mappingError = mappingQueries.find((query) => query.error)?.error;
  const error =
    project.error ??
    connection.error ??
    health.error ??
    capabilities.error ??
    diagnostics.error ??
    syncRuns.error ??
    applications.error ??
    environments.error ??
    products.error ??
    entitlements.error ??
    mappingError;
  const state = resolveHostedQueryState({
    emptyDescription:
      "Return to Commerce providers and choose an existing connection.",
    emptyTitle: "Provider Connection unavailable",
    error,
    isEmpty: connection.isSuccess && !connection.data,
    isPending:
      project.isPending ||
      connection.isPending ||
      (scopeReady &&
        (health.isPending ||
          capabilities.isPending ||
          diagnostics.isPending ||
          syncRuns.isPending ||
          applications.isPending ||
          environments.isPending ||
          products.isPending ||
          entitlements.isPending ||
          mappingQueries.some((query) => query.isPending))),
    loadingDescription:
      "Loading provider health, capabilities, diagnostics, and synchronization.",
    onRetry: () => {
      project.refetch();
      connection.refetch();
      health.refetch();
      capabilities.refetch();
      diagnostics.refetch();
      syncRuns.refetch();
    },
    permissionDescription:
      "Project membership is required to inspect this Provider Connection.",
  });
  const connectionData = connection.data;
  const scopedApplicationIds = new Set(connectionData?.applicationIds ?? []);
  const scopedEnvironmentIds = new Set(connectionData?.environmentIds ?? []);
  const scopedApplications =
    applications.data?.items.filter((item) =>
      scopedApplicationIds.has(item.id)
    ) ?? [];
  const scopedEnvironments = connectionData
    ? (environments.data?.items.filter(
        (item) =>
          scopedEnvironmentIds.has(item.id) &&
          environmentMatchesConnectionMode(item.mode, connectionData.mode)
      ) ?? [])
    : [];
  const affectedProducts =
    products.data?.items.filter((_, index) =>
      mappingQueries[index]?.data?.items.some(
        (mapping) => mapping.connectionId === connectionId
      )
    ) ?? [];
  const credentialActions = connection.data
    ? providerCredentialActions(
        connection.data,
        health.data?.status ?? connection.data.healthStatus
      )
    : { reconnect: false, rotate: false };

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="This connection is not owned by the routed Organization and Project. Provider health and catalog data were not loaded."
        title="Provider Connection unavailable in this scope"
      >
        <a
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`}
        >
          Return to Commerce providers
        </a>
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage
      actions={
        <a
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`}
        >
          <ArrowLeftIcon aria-hidden /> All providers
        </a>
      }
      description="Inspect health, least-privilege capabilities, catalog synchronization, and recovery without exposing provider authorization material."
      eyebrow="Catalog · Provider Connection"
      title={connection.data?.name ?? "Provider Connection"}
    >
      <HostedResourceBoundary state={state}>
        <ProviderConnectionDetailBody
          affectedProducts={affectedProducts}
          capabilities={capabilities.data}
          catalogError={catalog.error}
          catalogPending={catalog.isPending}
          catalogPreview={catalog.data}
          catalogRequested={catalogRequested}
          confirmRevoke={confirmRevoke}
          connection={connection.data}
          credentialActions={credentialActions}
          diagnostics={diagnostics.data}
          entitlements={entitlements.data?.items ?? []}
          healthStatus={health.data?.status}
          onCancelRevoke={handleClick5}
          onConfirmRevoke={handleClick4}
          onImport={(items, idempotencyKey) =>
            importProducts.mutateAsync({ idempotencyKey, items })
          }
          onLoadCatalog={handleClick7}
          onReconnect={async (credential) => {
            await reconnect.mutateAsync({ credential });
          }}
          onRefreshSyncRuns={handleClick6}
          onRequestRevoke={handleClick3}
          onRetryCatalog={() => {
            catalog.refetch();
          }}
          onRotate={async (credential) => {
            await rotate.mutateAsync({ credential });
          }}
          onSync={handleClick2}
          onTest={handleClick}
          organizationId={organizationId}
          products={products.data?.items ?? []}
          projectId={projectId}
          revokeError={revoke.error}
          revokePending={revoke.isPending}
          scopedApplications={scopedApplications}
          scopedEnvironments={scopedEnvironments}
          syncError={sync.error}
          syncJob={sync.data}
          syncPending={sync.isPending}
          syncRuns={syncRuns.data}
          testError={testConnection.error}
          testPending={testConnection.isPending}
        />
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}

/**
 * Everything the detail page shows once the reads have resolved.
 */
function ProviderConnectionDetailBody({
  affectedProducts,
  capabilities,
  catalogError,
  catalogPending,
  catalogPreview,
  catalogRequested,
  confirmRevoke,
  connection,
  credentialActions,
  diagnostics,
  entitlements,
  healthStatus,
  onCancelRevoke,
  onConfirmRevoke,
  onImport,
  onLoadCatalog,
  onReconnect,
  onRefreshSyncRuns,
  onRequestRevoke,
  onRetryCatalog,
  onRotate,
  onSync,
  onTest,
  organizationId,
  products,
  projectId,
  revokeError,
  revokePending,
  scopedApplications,
  scopedEnvironments,
  syncError,
  syncJob,
  syncPending,
  syncRuns,
  testError,
  testPending,
}: {
  affectedProducts: readonly Product[];
  capabilities: ProviderConnectionCapabilities | undefined;
  catalogError: Error | null;
  catalogPending: boolean;
  catalogPreview: ProviderCatalogPreviewView | undefined;
  catalogRequested: boolean;
  confirmRevoke: boolean;
  connection: ProviderConnection | undefined;
  credentialActions: { reconnect: boolean; rotate: boolean };
  diagnostics: readonly ProviderDiagnostic[] | undefined;
  entitlements: readonly Entitlement[];
  healthStatus: string | undefined;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  onImport: ComponentProps<typeof ProviderCatalogImport>["onImport"];
  onLoadCatalog: () => void;
  onReconnect: (credential: string) => Promise<void>;
  onRefreshSyncRuns: () => void;
  onRequestRevoke: () => void;
  onRetryCatalog: () => void;
  onRotate: (credential: string) => Promise<void>;
  onSync: () => void;
  onTest: () => void;
  organizationId: string;
  products: readonly Product[];
  projectId: string;
  revokeError: Error | null;
  revokePending: boolean;
  scopedApplications: readonly Application[];
  scopedEnvironments: readonly Environment[];
  syncError: Error | null;
  syncJob: ProviderSyncJob | undefined;
  syncPending: boolean;
  syncRuns: readonly ProviderSyncRun[] | undefined;
  testError: Error | null;
  testPending: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="State" value={connection?.status ?? "—"} />
        <Metric label="Health" value={healthStatus ?? "—"} />
        <Metric label="Mode" value={connection?.mode ?? "—"} />
        <Metric
          label="Credential"
          value={
            connection?.credential ? "Encrypted · present" : "Not available"
          }
        />
      </div>

      <ConnectionOperationsPanel
        affectedProducts={affectedProducts}
        confirmRevoke={confirmRevoke}
        connection={connection}
        credentialActions={credentialActions}
        healthStatus={healthStatus}
        onCancelRevoke={onCancelRevoke}
        onConfirmRevoke={onConfirmRevoke}
        onReconnect={onReconnect}
        onRequestRevoke={onRequestRevoke}
        onRotate={onRotate}
        onSync={onSync}
        onTest={onTest}
        organizationId={organizationId}
        projectId={projectId}
        revokeError={revokeError}
        revokePending={revokePending}
        syncError={syncError}
        syncJob={syncJob}
        syncPending={syncPending}
        testError={testError}
        testPending={testPending}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <CapabilitiesPanel capabilities={capabilities} />
        <DiagnosticsPanel diagnostics={diagnostics} />
      </div>

      <SynchronizationHistoryPanel
        affectedProducts={affectedProducts}
        onRefresh={onRefreshSyncRuns}
        runs={syncRuns}
      />

      <CatalogImportPanel
        catalogError={catalogError}
        catalogPending={catalogPending}
        catalogRequested={catalogRequested}
        connection={connection}
        entitlements={entitlements}
        onImport={onImport}
        onLoadCatalog={onLoadCatalog}
        onRetryCatalog={onRetryCatalog}
        organizationId={organizationId}
        preview={catalogPreview}
        products={products}
        projectId={projectId}
        scopedApplications={scopedApplications}
        scopedEnvironments={scopedEnvironments}
      />

      {connection?.credential ? (
        <p className="text-muted-foreground text-xs">
          Credential metadata: fingerprint {connection.credential.fingerprint} ·
          envelope v{connection.credential.envelopeVersion} · key{" "}
          {connection.credential.keyId}. No authorization material is returned.
        </p>
      ) : null}
    </>
  );
}

/**
 * Test, rotate, reconnect, synchronize, and revoke.
 */
function ConnectionOperationsPanel({
  affectedProducts,
  confirmRevoke,
  connection,
  credentialActions,
  healthStatus,
  onCancelRevoke,
  onConfirmRevoke,
  onReconnect,
  onRequestRevoke,
  onRotate,
  onSync,
  onTest,
  organizationId,
  projectId,
  revokeError,
  revokePending,
  syncError,
  syncJob,
  syncPending,
  testError,
  testPending,
}: {
  affectedProducts: readonly Product[];
  confirmRevoke: boolean;
  connection: ProviderConnection | undefined;
  credentialActions: { reconnect: boolean; rotate: boolean };
  healthStatus: string | undefined;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  onReconnect: (credential: string) => Promise<void>;
  onRequestRevoke: () => void;
  onRotate: (credential: string) => Promise<void>;
  onSync: () => void;
  onTest: () => void;
  organizationId: string;
  projectId: string;
  revokeError: Error | null;
  revokePending: boolean;
  syncError: Error | null;
  syncJob: ProviderSyncJob | undefined;
  syncPending: boolean;
  testError: Error | null;
  testPending: boolean;
}) {
  return (
    <WorkflowPanel
      description="Testing reads the scoped provider catalog and returns only normalized health."
      title="Connection operations"
    >
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={testPending || connection?.status === "revoked"}
          onClick={onTest}
          type="button"
        >
          {testPending ? "Testing…" : "Test connection"}
        </Button>
        {credentialActions.rotate && connection ? (
          <ProviderCredentialSheet
            action="rotate"
            onSubmit={onRotate}
            provider={connection.provider}
          />
        ) : null}
        {credentialActions.reconnect && connection ? (
          <ProviderCredentialSheet
            action="reconnect"
            onSubmit={onReconnect}
            provider={connection.provider}
          />
        ) : null}
        <Button
          disabled={
            syncPending ||
            connection?.status !== "active" ||
            healthStatus !== "healthy"
          }
          onClick={onSync}
          type="button"
          variant="outline"
        >
          <ArrowsClockwiseIcon aria-hidden />
          {syncPending ? "Queueing…" : "Synchronize catalog"}
        </Button>
        <Button
          disabled={connection?.status === "revoked"}
          onClick={onRequestRevoke}
          type="button"
          variant="destructive"
        >
          Revoke
        </Button>
      </div>
      {testError || syncError ? (
        <p className="mt-3 text-destructive text-sm" role="alert">
          {(testError ?? syncError)?.message}
        </p>
      ) : null}
      {syncJob ? (
        <p className="mt-3 text-muted-foreground text-sm" role="status">
          Synchronization job {syncJob.id} is {syncJob.status}. Refresh history
          to follow recovery attempts.
        </p>
      ) : null}
      {confirmRevoke ? (
        <RevokeConnectionConfirm
          affectedProducts={affectedProducts}
          connection={connection}
          onCancel={onCancelRevoke}
          onConfirm={onConfirmRevoke}
          organizationId={organizationId}
          projectId={projectId}
          revokeError={revokeError}
          revokePending={revokePending}
        />
      ) : null}
    </WorkflowPanel>
  );
}

/**
 * What revocation blocks, stated against the Products it would block, before it
 * is confirmed.
 */
function RevokeConnectionConfirm({
  affectedProducts,
  connection,
  onCancel,
  onConfirm,
  organizationId,
  projectId,
  revokeError,
  revokePending,
}: {
  affectedProducts: readonly Product[];
  connection: ProviderConnection | undefined;
  onCancel: () => void;
  onConfirm: () => void;
  organizationId: string;
  projectId: string;
  revokeError: Error | null;
  revokePending: boolean;
}) {
  return (
    <div className="mt-4 rounded border border-destructive/25 bg-destructive/5 p-4">
      <p className="font-semibold text-sm">Revoke this connection?</p>
      <p className="mt-1 text-muted-foreground text-sm leading-6">
        This blocks synchronization and provider readiness across{" "}
        {connection?.applicationIds.length ?? 0} Application scope(s) and{" "}
        {connection?.environmentIds.length ?? 0} Environment scope(s). Existing
        immutable releases remain historical; reconnect with a new credential to
        recover.
      </p>
      {affectedProducts.length > 0 ? (
        <div className="mt-3">
          <p className="font-medium text-sm">
            {affectedProducts.length} connected Product(s), their Paywalls,
            Placements, and active-provider assignments may be blocked:
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {affectedProducts.map((product) => (
              <li key={product.id}>
                <a
                  className="font-medium text-primary"
                  href={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/products/${encodeURIComponent(product.id)}`}
                >
                  Review {product.internalName} usage and recovery
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm">
          No connected Products are currently affected.
        </p>
      )}
      {revokeError ? (
        <p className="mt-2 text-destructive text-sm" role="alert">
          {revokeError.message}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          disabled={revokePending}
          onClick={onConfirm}
          type="button"
          variant="destructive"
        >
          {revokePending ? "Revoking…" : "Confirm revoke"}
        </Button>
        <Button
          disabled={revokePending}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Least-privilege capability support and the read permissions it needs.
 */
function CapabilitiesPanel({
  capabilities,
}: {
  capabilities: ProviderConnectionCapabilities | undefined;
}) {
  return (
    <WorkflowPanel
      description="Provider support can vary by runtime and platform."
      title="Capabilities"
    >
      <ul className="space-y-2">
        {(capabilities?.capabilities ?? []).map((capability) => (
          <li
            className="flex items-start justify-between gap-3 rounded border p-3"
            key={capability.name}
          >
            <span className="font-medium text-sm">{capability.name}</span>
            <span className="text-right text-muted-foreground text-xs">
              {capability.support}
              {capability.reasonCode ? ` · ${capability.reasonCode}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <h3 className="mt-4 font-semibold text-xs uppercase tracking-wide">
        Required read permissions
      </h3>
      <ul className="mt-2 space-y-1 font-mono text-muted-foreground text-xs">
        {(capabilities?.requiredPermissions ?? []).map((permission) => (
          <li key={permission}>{permission}</li>
        ))}
      </ul>
    </WorkflowPanel>
  );
}

/**
 * Safe provider failure codes and their correlation IDs.
 */
function DiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: readonly ProviderDiagnostic[] | undefined;
}) {
  return (
    <WorkflowPanel
      description="Safe codes and correlation IDs only; provider response bodies are never shown."
      title="Diagnostics"
    >
      {(diagnostics ?? []).length === 0 ? (
        <p className="text-sm">No provider diagnostics recorded.</p>
      ) : (
        <ul className="space-y-2">
          {diagnostics?.map((diagnostic) => (
            <li className="rounded border p-3 text-xs" key={diagnostic.id}>
              <p className="flex items-center gap-2 font-semibold">
                <WarningCircleIcon aria-hidden className="text-destructive" />
                {diagnostic.code} · {diagnostic.operation}
              </p>
              <p className="mt-1 text-muted-foreground">
                {diagnostic.occurredAt} · correlation {diagnostic.correlationId}{" "}
                ·{" "}
                {diagnostic.retryable
                  ? "retryable"
                  : "review credential or scope"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </WorkflowPanel>
  );
}

/**
 * Bounded synchronization attempts and their partial outcomes.
 */
function SynchronizationHistoryPanel({
  affectedProducts,
  onRefresh,
  runs,
}: {
  affectedProducts: readonly Product[];
  onRefresh: () => void;
  runs: readonly ProviderSyncRun[] | undefined;
}) {
  return (
    <WorkflowPanel
      description="Every run reports bounded attempts and partial outcomes. All mappings on this connection are affected."
      title="Synchronization history"
    >
      <p className="mb-3 text-muted-foreground text-xs">
        Affected Products:{" "}
        {affectedProducts.length > 0
          ? affectedProducts.map((product) => product.internalName).join(", ")
          : "No mapped Products"}
      </p>
      {(runs ?? []).length === 0 ? (
        <p className="text-sm">No synchronization runs yet.</p>
      ) : (
        <ul className="space-y-2">
          {runs?.map((run) => (
            <li className="rounded border p-3" key={run.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-sm">
                  {run.status} · {run.successCount}/{run.itemCount} synchronized
                </p>
                <span className="text-muted-foreground text-xs">
                  {run.startedAt}
                </span>
              </div>
              {run.failureCount > 0 ? (
                <p className="mt-1 text-destructive text-xs">
                  {run.failureCount} mapping(s) failed. Run synchronization
                  again after resolving the latest diagnostic.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Button
        className="mt-3"
        onClick={onRefresh}
        size="sm"
        type="button"
        variant="outline"
      >
        Refresh history
      </Button>
    </WorkflowPanel>
  );
}

/**
 * The live provider catalog, loaded only when an operator asks for it.
 */
function CatalogImportPanel({
  catalogError,
  catalogPending,
  catalogRequested,
  connection,
  entitlements,
  onImport,
  onLoadCatalog,
  onRetryCatalog,
  organizationId,
  preview,
  products,
  projectId,
  scopedApplications,
  scopedEnvironments,
}: {
  catalogError: Error | null;
  catalogPending: boolean;
  catalogRequested: boolean;
  connection: ProviderConnection | undefined;
  entitlements: readonly Entitlement[];
  onImport: ComponentProps<typeof ProviderCatalogImport>["onImport"];
  onLoadCatalog: () => void;
  onRetryCatalog: () => void;
  organizationId: string;
  preview: ProviderCatalogPreviewView | undefined;
  products: readonly Product[];
  projectId: string;
  scopedApplications: readonly Application[];
  scopedEnvironments: readonly Environment[];
}) {
  return (
    <WorkflowPanel
      description={`Preview the live ${connection ? providerConnectionLabel(connection.provider) : "provider"} catalog, then map selected resources to stable Mosaic Products and Entitlements.`}
      title="Catalog import"
    >
      {catalogRequested ? (
        (() => {
          if (catalogPending) {
            return (
              <p aria-live="polite" className="text-muted-foreground text-sm">
                Loading normalized provider catalog…
              </p>
            );
          }
          if (catalogError) {
            return (
              <div role="alert">
                <p className="text-destructive text-sm">
                  {catalogError.message}
                </p>
                <Button
                  className="mt-2"
                  onClick={onRetryCatalog}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Retry catalog preview
                </Button>
              </div>
            );
          }
          if (preview) {
            return (
              <ProviderCatalogImport
                applications={scopedApplications}
                catalogProductsHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/products`}
                entitlements={entitlements}
                environments={scopedEnvironments}
                onImport={onImport}
                preview={preview}
                products={products}
                provider={connection?.provider}
                providersHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`}
              />
            );
          }
          return null;
        })()
      ) : (
        <Button
          disabled={connection?.status === "revoked"}
          onClick={onLoadCatalog}
          type="button"
        >
          Load provider catalog
        </Button>
      )}
    </WorkflowPanel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 font-semibold text-sm capitalize">
        {value === "healthy" ? (
          <CheckCircleIcon aria-hidden className="text-primary" />
        ) : null}
        {value.replaceAll("_", " ")}
      </p>
    </div>
  );
}
