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
import { useCallback, useState } from "react";

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
import { providerCredentialActions } from "@/features/provider-connections/types/provider-connection-view";
import { environmentMatchesConnectionMode } from "@/features/provider-connections/types/provider-operation-input";

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
  const scopedApplications =
    applications.data?.items.filter((item) =>
      connection.data?.applicationIds.includes(item.id)
    ) ?? [];
  const scopedEnvironments =
    environments.data?.items.filter(
      (item) =>
        connection.data?.environmentIds.includes(item.id) &&
        environmentMatchesConnectionMode(item.mode, connection.data.mode)
    ) ?? [];
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="State" value={connection.data?.status ?? "—"} />
          <Metric label="Health" value={health.data?.status ?? "—"} />
          <Metric label="Mode" value={connection.data?.mode ?? "—"} />
          <Metric
            label="Credential"
            value={
              connection.data?.credential
                ? "Encrypted · present"
                : "Not available"
            }
          />
        </div>

        <WorkflowPanel
          description="Testing reads the scoped provider catalog and returns only normalized health."
          title="Connection operations"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                testConnection.isPending ||
                connection.data?.status === "revoked"
              }
              onClick={handleClick}
              type="button"
            >
              {testConnection.isPending ? "Testing…" : "Test connection"}
            </Button>
            {credentialActions.rotate ? (
              <ProviderCredentialSheet
                action="rotate"
                onSubmit={async (credential) => {
                  await rotate.mutateAsync({ credential });
                }}
              />
            ) : null}
            {credentialActions.reconnect ? (
              <ProviderCredentialSheet
                action="reconnect"
                onSubmit={async (credential) => {
                  await reconnect.mutateAsync({ credential });
                }}
              />
            ) : null}
            <Button
              disabled={
                sync.isPending ||
                connection.data?.status !== "active" ||
                health.data?.status !== "healthy"
              }
              onClick={handleClick2}
              type="button"
              variant="outline"
            >
              <ArrowsClockwiseIcon aria-hidden />
              {sync.isPending ? "Queueing…" : "Synchronize catalog"}
            </Button>
            <Button
              disabled={connection.data?.status === "revoked"}
              onClick={handleClick3}
              type="button"
              variant="destructive"
            >
              Revoke
            </Button>
          </div>
          {testConnection.error || sync.error ? (
            <p className="mt-3 text-destructive text-sm" role="alert">
              {(testConnection.error ?? sync.error)?.message}
            </p>
          ) : null}
          {sync.data ? (
            <p className="mt-3 text-muted-foreground text-sm" role="status">
              Synchronization job {sync.data.id} is {sync.data.status}. Refresh
              history to follow recovery attempts.
            </p>
          ) : null}
          {confirmRevoke ? (
            <div className="mt-4 rounded border border-destructive/25 bg-destructive/5 p-4">
              <p className="font-semibold text-sm">Revoke this connection?</p>
              <p className="mt-1 text-muted-foreground text-sm leading-6">
                This blocks synchronization and provider readiness across{" "}
                {connection.data?.applicationIds.length ?? 0} Application
                scope(s) and {connection.data?.environmentIds.length ?? 0}{" "}
                Environment scope(s). Existing immutable releases remain
                historical; reconnect with a new credential to recover.
              </p>
              {affectedProducts.length > 0 ? (
                <div className="mt-3">
                  <p className="font-medium text-sm">
                    {affectedProducts.length} connected Product(s), their
                    Paywalls, Placements, and active-provider assignments may be
                    blocked:
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
              {revoke.error ? (
                <p className="mt-2 text-destructive text-sm" role="alert">
                  {revoke.error.message}
                </p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <Button
                  disabled={revoke.isPending}
                  onClick={handleClick4}
                  type="button"
                  variant="destructive"
                >
                  {revoke.isPending ? "Revoking…" : "Confirm revoke"}
                </Button>
                <Button
                  disabled={revoke.isPending}
                  onClick={handleClick5}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </WorkflowPanel>

        <div className="grid gap-5 lg:grid-cols-2">
          <WorkflowPanel
            description="Provider support can vary by runtime and platform."
            title="Capabilities"
          >
            <ul className="space-y-2">
              {(capabilities.data?.capabilities ?? []).map((capability) => (
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
              {(capabilities.data?.requiredPermissions ?? []).map(
                (permission) => (
                  <li key={permission}>{permission}</li>
                )
              )}
            </ul>
          </WorkflowPanel>

          <WorkflowPanel
            description="Safe codes and correlation IDs only; provider response bodies are never shown."
            title="Diagnostics"
          >
            {(diagnostics.data ?? []).length === 0 ? (
              <p className="text-sm">No provider diagnostics recorded.</p>
            ) : (
              <ul className="space-y-2">
                {diagnostics.data?.map((diagnostic) => (
                  <li
                    className="rounded border p-3 text-xs"
                    key={diagnostic.id}
                  >
                    <p className="flex items-center gap-2 font-semibold">
                      <WarningCircleIcon
                        aria-hidden
                        className="text-destructive"
                      />
                      {diagnostic.code} · {diagnostic.operation}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {diagnostic.occurredAt} · correlation{" "}
                      {diagnostic.correlationId} ·{" "}
                      {diagnostic.retryable
                        ? "retryable"
                        : "review credential or scope"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </WorkflowPanel>
        </div>

        <WorkflowPanel
          description="Every run reports bounded attempts and partial outcomes. All mappings on this connection are affected."
          title="Synchronization history"
        >
          <p className="mb-3 text-muted-foreground text-xs">
            Affected Products:{" "}
            {affectedProducts.length > 0
              ? affectedProducts
                  .map((product) => product.internalName)
                  .join(", ")
              : "No mapped Products"}
          </p>
          {(syncRuns.data ?? []).length === 0 ? (
            <p className="text-sm">No synchronization runs yet.</p>
          ) : (
            <ul className="space-y-2">
              {syncRuns.data?.map((run) => (
                <li className="rounded border p-3" key={run.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-sm">
                      {run.status} · {run.successCount}/{run.itemCount}{" "}
                      synchronized
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
            onClick={handleClick6}
            size="sm"
            type="button"
            variant="outline"
          >
            Refresh history
          </Button>
        </WorkflowPanel>

        <WorkflowPanel
          description="Preview the live RevenueCat catalog, then map selected resources to stable Mosaic Products and Entitlements."
          title="Catalog import"
        >
          {catalogRequested ? (
            (() => {
              if (catalog.isPending) {
                return (
                  <p
                    aria-live="polite"
                    className="text-muted-foreground text-sm"
                  >
                    Loading normalized provider catalog…
                  </p>
                );
              }
              if (catalog.error) {
                return (
                  <div role="alert">
                    <p className="text-destructive text-sm">
                      {catalog.error.message}
                    </p>
                    <Button
                      className="mt-2"
                      onClick={() => {
                        catalog.refetch();
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Retry catalog preview
                    </Button>
                  </div>
                );
              }
              if (catalog.data) {
                return (
                  <ProviderCatalogImport
                    applications={scopedApplications}
                    catalogProductsHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/products`}
                    entitlements={entitlements.data?.items ?? []}
                    environments={scopedEnvironments}
                    onImport={(items, idempotencyKey) =>
                      importProducts.mutateAsync({ idempotencyKey, items })
                    }
                    preview={catalog.data}
                    products={products.data?.items ?? []}
                    providersHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`}
                  />
                );
              }
              return null;
            })()
          ) : (
            <Button
              disabled={connection.data?.status === "revoked"}
              onClick={handleClick7}
              type="button"
            >
              Load provider catalog
            </Button>
          )}
        </WorkflowPanel>

        {connection.data?.credential ? (
          <p className="text-muted-foreground text-xs">
            Credential metadata: fingerprint{" "}
            {connection.data.credential.fingerprint} · envelope v
            {connection.data.credential.envelopeVersion} · key{" "}
            {connection.data.credential.keyId}. No authorization material is
            returned.
          </p>
        ) : null}
      </HostedResourceBoundary>
    </WorkspacePage>
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
