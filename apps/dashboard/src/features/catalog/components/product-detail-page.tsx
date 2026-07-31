import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { NativeProviderMappingSheet } from "@/features/catalog/components/native-provider-mapping-sheet";
import { ProductPlatformCoverage } from "@/features/catalog/components/product-platform-coverage";
import { ProductReadinessPanel } from "@/features/catalog/components/product-readiness-panel";
import { ProviderMappingsPanel } from "@/features/catalog/components/provider-mappings-panel";
import {
  archiveProviderMappingMutationOptions,
  createProviderMappingDraftMutationOptions,
  productLifecycleMutationOptions,
  replaceProviderMappingMutationOptions,
  setProductReplacementMutationOptions,
} from "@/features/catalog/mutations/catalog-mutations";
import {
  productEntitlementsQueryOptions,
  productQueryOptions,
  productReadinessQueryOptions,
  productsQueryOptions,
  productUsageQueryOptions,
  providerMappingMetadataQueryOptions,
  providerMappingObservationsQueryOptions,
  providerMappingsQueryOptions,
  providerMappingUsageQueryOptions,
} from "@/features/catalog/queries/catalog-query";
import {
  productReadinessView,
  providerMappingView,
  readinessStateLabel,
} from "@/features/catalog/types/connected-product-view";
import {
  canConfirmProductArchive,
  countProductUsage,
  replacementCandidates,
} from "@/features/catalog/types/product-lifecycle";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { detectNestedScopeMismatch } from "@/features/orgs/types/nested-scope";
import {
  applicationsQueryOptions,
  projectQueryOptions,
} from "@/features/projects/queries/projects-query";
import { providerConnectionsQueryOptions } from "@/features/provider-connections/queries/provider-connection-queries";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import {
  describeReturnDestination,
  grantVersionsHref,
} from "@/lib/routing/workspace-hrefs";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";

interface ProductDetailPageProps {
  onReadinessScopeChange: (scope: {
    applicationId?: string;
    environmentId?: string;
  }) => void;
  organizationId: string;
  productId: string;
  projectId: string;
  readinessApplicationId?: string;
  readinessEnvironmentId?: string;
  returnTo?: string;
}

export function ProductDetailPage({
  onReadinessScopeChange,
  organizationId,
  productId,
  projectId,
  readinessApplicationId,
  readinessEnvironmentId,
  returnTo,
}: ProductDetailPageProps) {
  const handleClick = useCallback(() => {
    setSelectedReplacementId(null);
    setShowLifecycle(true);
  }, []);
  const queryClient = useQueryClient();
  const access = useOrganizationAccess(organizationId);
  const [showLifecycle, setShowLifecycle] = useState(false);
  const [selectedReplacementId, setSelectedReplacementId] = useState<
    string | null
  >(null);
  const project = useQuery(projectQueryOptions(projectId));
  const product = useQuery(productQueryOptions(productId));
  const scopeMismatch = detectNestedScopeMismatch({
    expectedOrganizationId: organizationId,
    expectedProjectId: projectId,
    expectedResourceId: productId,
    project: project.data,
    resource: product.data,
  });
  const scopeReady =
    project.isSuccess && product.isSuccess && scopeMismatch === null;
  const usage = useQuery({
    ...productUsageQueryOptions(productId),
    enabled: scopeReady,
  });
  const mappings = useQuery({
    ...providerMappingsQueryOptions(productId),
    enabled: scopeReady,
  });
  const metadataQueries = useQueries({
    queries: (mappings.data?.items ?? []).map((mapping) => ({
      ...providerMappingMetadataQueryOptions(mapping.id),
      enabled:
        scopeReady &&
        Boolean(mapping.currentSnapshotId) &&
        mapping.status !== "archived",
    })),
  });
  const observationQueries = useQueries({
    queries: (mappings.data?.items ?? []).map((mapping) => ({
      ...providerMappingObservationsQueryOptions(mapping.id),
      enabled:
        scopeReady &&
        (mapping.provider === "app_store" ||
          mapping.provider === "google_play"),
    })),
  });
  const grants = useQuery({
    ...productEntitlementsQueryOptions(productId),
    enabled: scopeReady,
  });
  const replacements = useQuery({
    ...productsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const connections = useQuery({
    ...providerConnectionsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const selectedReadinessApplication = applications.data?.items.find(
    (application) => application.id === readinessApplicationId
  );
  const selectedReadinessEnvironment = environments.data?.items.find(
    (environment) => environment.id === readinessEnvironmentId
  );
  const hasExplicitReadinessScope = Boolean(
    selectedReadinessApplication && selectedReadinessEnvironment
  );
  const readiness = useQuery({
    ...productReadinessQueryOptions(
      productId,
      readinessEnvironmentId ?? "unselected",
      readinessApplicationId ?? "unselected"
    ),
    enabled: scopeReady && hasExplicitReadinessScope,
  });
  const coverageReadinessQueries = useQueries({
    queries: (applications.data?.items ?? []).map((application) => ({
      ...productReadinessQueryOptions(
        productId,
        readinessEnvironmentId ?? "unselected",
        application.id
      ),
      enabled: scopeReady && Boolean(selectedReadinessEnvironment),
    })),
  });
  const archive = useMutation(
    productLifecycleMutationOptions(queryClient, "archive")
  );
  const restore = useMutation(
    productLifecycleMutationOptions(queryClient, "restore")
  );
  const setReplacement = useMutation(
    setProductReplacementMutationOptions(productId, queryClient)
  );
  const archiveMapping = useMutation(
    archiveProviderMappingMutationOptions(productId, projectId, queryClient)
  );
  const createMapping = useMutation(
    createProviderMappingDraftMutationOptions(productId, projectId, queryClient)
  );
  const replaceMapping = useMutation(
    replaceProviderMappingMutationOptions(productId, projectId, queryClient)
  );
  const error =
    project.error ??
    product.error ??
    usage.error ??
    readiness.error ??
    mappings.error ??
    applications.error ??
    environments.error ??
    connections.error ??
    access.error;
  const state = resolveHostedQueryState({
    emptyDescription: "Return to Products and choose an existing Product.",
    emptyTitle: "Product unavailable",
    error,
    isEmpty: product.isSuccess && !product.data,
    isPending:
      project.isPending ||
      product.isPending ||
      access.isPending ||
      (scopeReady &&
        (usage.isPending ||
          (hasExplicitReadinessScope && readiness.isPending) ||
          mappings.isPending ||
          applications.isPending ||
          environments.isPending ||
          connections.isPending)),
    loadingDescription: "Loading Product identity, readiness, and usage.",
    onRetry: () => {
      project.refetch();
      product.refetch();
      usage.refetch();
      if (hasExplicitReadinessScope) {
        readiness.refetch();
      }
      mappings.refetch();
      applications.refetch();
      environments.refetch();
      connections.refetch();
    },
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={(prev) => ({
          ...prev,
          ...workspaceScopeParams(prev),
        })}
        to="/orgs/$organizationId/projects/$projectId/env/$environmentKey"
      >
        Return to Project
      </Link>
    ),
    permissionDescription:
      "Project membership is required to inspect Product usage.",
    scope: { organizationId, projectId },
  });
  const usageCount = countProductUsage(usage.data);
  const isArchived = product.data?.status === "archived";
  const replacementOptions = replacementCandidates(
    replacements.data?.items ?? [],
    productId,
    product.data?.type
  );
  const replacementSelectOptions = replacementOptions.map((item) => ({
    label: item.internalName,
    value: item.id,
  }));
  const readinessEnvironmentOptions = [
    { label: "Select Environment", value: "" },
    ...(environments.data?.items ?? []).map((environment) => ({
      label: `${environment.name} · ${environment.mode}`,
      value: environment.id,
    })),
  ];
  const readinessApplicationOptions = [
    { label: "Select Application", value: "" },
    ...(applications.data?.items ?? []).map((application) => ({
      label: `${application.name} · ${application.platform.toUpperCase()}`,
      value: application.id,
    })),
  ];
  const effectiveReplacementId =
    selectedReplacementId ?? product.data?.replacementProductId;
  const replacementNeedsSave = Boolean(
    selectedReplacementId &&
      selectedReplacementId !== product.data?.replacementProductId
  );
  const connectedReadiness = readiness.data
    ? productReadinessView(readiness.data)
    : null;
  const mappingViews =
    mappings.data?.items.map((mapping, index) =>
      providerMappingView(
        mapping,
        applications.data?.items ?? [],
        environments.data?.items ?? [],
        connections.data?.items ?? [],
        metadataQueries[index]?.data,
        observationQueries[index]?.data
      )
    ) ?? [];
  const coverageRows =
    applications.data?.items.map((application, index) => {
      const applicationReadiness = coverageReadinessQueries[index]?.data;
      return {
        application,
        readiness: applicationReadiness,
        mapping: applicationReadiness?.mappingId
          ? mappings.data?.items.find(
              (mapping) => mapping.id === applicationReadiness.mappingId
            )
          : undefined,
      };
    }) ?? [];
  const manageProvidersHref = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`;

  const confirmArchive = useCallback(async () => {
    try {
      if (replacementNeedsSave && selectedReplacementId) {
        await setReplacement.mutateAsync({
          previousReplacementProductId: product.data?.replacementProductId,
          replacementProductId: selectedReplacementId,
        });
      }
      await archive.mutateAsync(productId);
      setSelectedReplacementId(null);
      setShowLifecycle(false);
    } catch {
      // TanStack Mutation exposes the actionable API error in the workflow below.
    }
  }, [
    archive,
    product,
    productId,
    replacementNeedsSave,
    selectedReplacementId,
    setReplacement,
  ]);

  const handleClick2 = useCallback(() => {
    confirmArchive();
  }, [confirmArchive]);
  function cancelArchiveReview() {
    setSelectedReplacementId(null);
    setShowLifecycle(false);
  }

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed parent identifiers do not match this Product."
        title="Product unavailable in this Project"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage
      description={
        product.data?.description ?? "Stable provider-neutral Product identity."
      }
      eyebrow="Catalog · Product"
      title={product.data?.internalName ?? "Product"}
    >
      <HostedResourceBoundary state={state}>
        {returnTo ? (
          <a
            className="inline-flex font-semibold text-primary text-sm"
            href={returnTo}
          >
            {describeReturnDestination(returnTo)}
          </a>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Metric
            label="Status"
            value={product.data?.status.replaceAll("_", " ") ?? "—"}
          />
          <Metric
            label="Metadata"
            value={
              product.data?.metadataSource === "provider"
                ? "Provider-owned"
                : "Mock metadata"
            }
          />
          <Metric
            label="Readiness"
            value={
              readiness.data
                ? readinessStateLabel(readiness.data.state)
                : hasExplicitReadinessScope
                  ? "Checking…"
                  : "Select scope"
            }
          />
        </div>

        <WorkflowPanel
          description="These fields belong to Mosaic and remain stable when provider mappings or credentials change."
          title="Mosaic-owned Product"
        >
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Internal name"
              value={product.data?.internalName ?? "—"}
            />
            <Metric label="Product key" value={product.data?.key ?? "—"} />
            <Metric
              label="Type"
              value={product.data?.type.replaceAll("_", " ") ?? "—"}
            />
            <Metric
              label="Entitlement grants"
              value={`${grants.data?.items.length ?? 0}`}
            />
          </dl>
          <p className="mt-4 text-muted-foreground text-sm">
            {product.data?.description || "No internal description."} Provider
            display names, localized prices, periods, offers, and availability
            are synchronized read-only evidence below and never overwrite this
            identity.
          </p>
        </WorkflowPanel>

        <WorkflowPanel
          description="Choose one Environment and one registered Application. Mosaic does not fall back to project-wide or another platform’s readiness."
          title="Readiness scope"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="font-medium text-sm">
              <label htmlFor="readiness-environment">Environment</label>
              <Select
                items={readinessEnvironmentOptions}
                onValueChange={(value) =>
                  onReadinessScopeChange({
                    applicationId: selectedReadinessApplication?.id,
                    environmentId: value || undefined,
                  })
                }
                value={selectedReadinessEnvironment?.id ?? ""}
              >
                <SelectTrigger className="mt-2" id="readiness-environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {readinessEnvironmentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="font-medium text-sm">
              <label htmlFor="readiness-application">Application</label>
              <Select
                items={readinessApplicationOptions}
                onValueChange={(value) =>
                  onReadinessScopeChange({
                    applicationId: value || undefined,
                    environmentId: selectedReadinessEnvironment?.id,
                  })
                }
                value={selectedReadinessApplication?.id ?? ""}
              >
                <SelectTrigger className="mt-2" id="readiness-application">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {readinessApplicationOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {hasExplicitReadinessScope ? null : (
            <p className="mt-3 text-muted-foreground text-xs">
              Readiness is not requested until both scope values are explicitly
              selected.
            </p>
          )}
        </WorkflowPanel>

        <ProductPlatformCoverage
          connections={connections.data?.items ?? []}
          environment={selectedReadinessEnvironment}
          isLoading={coverageReadinessQueries.some((query) => query.isPending)}
          onInspect={(applicationId) =>
            onReadinessScopeChange({
              applicationId,
              environmentId: selectedReadinessEnvironment?.id,
            })
          }
          rows={coverageRows}
          selectedApplicationId={selectedReadinessApplication?.id}
        />

        {connectedReadiness ? (
          <ProductReadinessPanel
            accessHref="#access-grants-title"
            applicationsHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/apps`}
            manageProvidersHref={manageProvidersHref}
            readiness={connectedReadiness}
            scopeLabel={`${selectedReadinessEnvironment?.name ?? readiness.data?.environmentId} · ${selectedReadinessApplication?.name ?? readiness.data?.applicationId} · ${readiness.data?.platform.toUpperCase()}`}
          />
        ) : null}

        <WorkflowPanel
          description="Usage is always shown before lifecycle controls. Historical references keep this Mosaic Product ID stable."
          title="Used in"
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <UsageList
              items={usage.data?.plans.map((item) => item.name) ?? []}
              label="Plans"
            />
            <UsageList
              items={usage.data?.entitlements.map((item) => item.name) ?? []}
              label="Access"
            />
            <UsageList
              items={
                usage.data?.providerMappings.map(
                  (item) =>
                    `${item.provider}: ${item.providerProductIdentifier}`
                ) ?? []
              }
              label="Provider placeholders"
            />
            <UsageList
              items={usage.data?.historicalReferences ?? []}
              label="Historical references"
            />
          </div>
        </WorkflowPanel>

        {/* Retired in Phase 9B.
            A grant used to be a single mutable row here, so removing an
            Entitlement changed what every past purchase of this Product had
            meant — one DELETE away from mass revocation, with no record that it
            had ever granted anything. What a Product grants is now a versioned,
            immutable interval selected by each purchase's own effective time, so
            the change surface moved to Grant versions and this panel reads. */}
        <WorkflowPanel
          description="What this Product grants, as it stands today. These definitions describe access a Product grants; they are not any customer's entitlement state."
          title="Access grants"
        >
          <ul className="mb-4 divide-y">
            {grants.data?.items.map((entitlement) => (
              <li
                className="flex items-center justify-between gap-4 py-3 text-sm"
                key={entitlement.id}
              >
                <span>
                  {entitlement.name}{" "}
                  <span className="font-mono text-muted-foreground text-xs">
                    · {entitlement.key}
                  </span>
                </span>
                <a
                  className="font-semibold text-primary text-xs"
                  href={
                    grantVersionsHref(
                      { organizationId, projectId },
                      { entitlementId: entitlement.id, productId }
                    ) ?? "#"
                  }
                >
                  Version history
                </a>
              </li>
            ))}
          </ul>
          <p className="mb-3 text-muted-foreground text-sm leading-6">
            Changing what a Product grants publishes a new immutable grant
            version rather than editing this list. The projection engine selects
            a version by each purchase&rsquo;s own effective time, so a change
            made here would otherwise rewrite what someone was entitled to at an
            instant that has already passed.
          </p>
          {access.canManage ? (
            <a
              className={buttonVariants({ variant: "outline" })}
              href={
                grantVersionsHref(
                  { organizationId, projectId },
                  { productId }
                ) ?? "#"
              }
            >
              Open grant versions
            </a>
          ) : (
            <a
              className="font-semibold text-primary text-sm"
              href={`/orgs/${encodeURIComponent(organizationId)}/members`}
            >
              Ask an Owner or Admin to change Access grants
            </a>
          )}
        </WorkflowPanel>

        <ProviderMappingsPanel
          canManage={access.canManage}
          error={
            archiveMapping.error ?? replaceMapping.error ?? createMapping.error
          }
          isPending={
            archiveMapping.isPending ||
            replaceMapping.isPending ||
            createMapping.isPending
          }
          manageProvidersHref={manageProvidersHref}
          mappings={mappingViews}
          membersHref={`/orgs/${encodeURIComponent(organizationId)}/members`}
          onArchive={async (mappingId) => {
            await archiveMapping.mutateAsync(mappingId);
          }}
          onLoadUsage={(mappingId) =>
            queryClient.fetchQuery(providerMappingUsageQueryOptions(mappingId))
          }
          onReplace={async (mappingId, body) => {
            await replaceMapping.mutateAsync({ body, mappingId });
          }}
          productType={product.data?.type}
        />

        {access.canManage &&
        product.data &&
        selectedReadinessApplication &&
        selectedReadinessEnvironment &&
        (readiness.data?.provider === "app_store" ||
          readiness.data?.provider === "google_play") ? (
          <WorkflowPanel
            description="The form is fixed to the selected Mosaic Product, Environment, Application, and platform."
            title="Add native store mapping"
          >
            <NativeProviderMappingSheet
              application={selectedReadinessApplication}
              environment={selectedReadinessEnvironment}
              onSubmit={async (input) => {
                await createMapping.mutateAsync({
                  applicationId: input.applicationId,
                  environmentId: input.environmentId,
                  provider: input.provider,
                  providerProductIdentifier: input.providerProductIdentifier,
                  ...(input.googleBasePlanId
                    ? { providerBasePlanIdentifier: input.googleBasePlanId }
                    : {}),
                  ...(input.googleOfferId
                    ? { providerOfferIdentifier: input.googleOfferId }
                    : {}),
                });
              }}
              product={product.data}
              provider={readiness.data.provider}
            />
          </WorkflowPanel>
        ) : null}

        <WorkflowPanel
          description="Archive removes this Product from future selection without deleting history. Restore preserves the same ID."
          title="Lifecycle"
        >
          {access.canManage ? (
            isArchived ? (
              <Button
                onClick={() => restore.mutate(productId)}
                variant="outline"
              >
                <ArrowCounterClockwiseIcon aria-hidden size={16} />
                Restore Product
              </Button>
            ) : (
              <Button onClick={handleClick} variant="outline">
                <ArchiveIcon aria-hidden size={16} />
                Review archive
              </Button>
            )
          ) : (
            <a
              className="font-semibold text-primary text-sm"
              href={`/orgs/${encodeURIComponent(organizationId)}/members`}
            >
              Ask an Owner or Admin to change Product lifecycle
            </a>
          )}
          {showLifecycle && !isArchived ? (
            <div className="mt-4 rounded border border-border bg-muted/35 p-4">
              <p className="font-semibold text-sm">
                {usageCount > 0
                  ? `This Product has ${usageCount} usage reference(s). Choose a replacement before archiving.`
                  : "This Product has no known usage and can be archived safely."}
              </p>
              {usageCount > 0 ? (
                <div className="mt-3 flex max-w-md flex-col gap-2 font-medium text-sm">
                  <label htmlFor="replacement-product">
                    Replacement Product
                  </label>
                  <Select
                    items={replacementSelectOptions}
                    onValueChange={(value) =>
                      setSelectedReplacementId(value || null)
                    }
                    value={effectiveReplacementId ?? ""}
                  >
                    <SelectTrigger id="replacement-product">
                      <SelectValue placeholder="Choose an active Product" />
                    </SelectTrigger>
                    <SelectContent>
                      {replacementSelectOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {usageCount > 0 && product.data?.replacementProductId ? (
                <p className="mt-2 text-muted-foreground text-sm">
                  An existing replacement is already recorded. Choose another
                  only if it should be changed before archive.
                </p>
              ) : null}
              {usageCount > 0 &&
              replacementOptions.length === 0 &&
              !effectiveReplacementId ? (
                <div className="mt-4">
                  <Link
                    className={buttonVariants({ variant: "outline" })}
                    params={(prev) => ({
                      ...prev,
                      ...workspaceScopeParams(prev),
                    })}
                    to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/products"
                  >
                    Create Replacement Product
                  </Link>
                </div>
              ) : null}
              <div className="mt-4 flex gap-2">
                <Button
                  disabled={
                    archive.isPending ||
                    setReplacement.isPending ||
                    !canConfirmProductArchive(
                      usageCount,
                      Boolean(effectiveReplacementId)
                    )
                  }
                  onClick={handleClick2}
                >
                  {setReplacement.isPending
                    ? "Saving replacement…"
                    : archive.isPending
                      ? "Archiving…"
                      : replacementNeedsSave
                        ? "Save replacement and archive"
                        : "Archive Product"}
                </Button>
                <Button
                  disabled={archive.isPending || setReplacement.isPending}
                  onClick={cancelArchiveReview}
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <p className="mt-4 text-muted-foreground text-sm">
            Destructive deletion is unavailable once referenced. Archive,
            replacement, and restore are the recovery paths.
          </p>
          {archive.error || restore.error || setReplacement.error ? (
            <p className="mt-3 text-destructive text-sm" role="alert">
              {
                (archive.error ?? restore.error ?? setReplacement.error)
                  ?.message
              }
            </p>
          ) : null}
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-4">
      <p className="font-medium text-muted-foreground text-xs uppercase">
        {label}
      </p>
      <p className="mt-2 font-semibold text-sm capitalize">{value}</p>
    </div>
  );
}
function UsageList({ items, label }: { items: string[]; label: string }) {
  return (
    <section aria-label={label}>
      <p className="font-semibold text-xs uppercase tracking-wide">{label}</p>
      {items.length ? (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li className="text-muted-foreground text-sm" key={item}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm">None</p>
      )}
    </section>
  );
}
