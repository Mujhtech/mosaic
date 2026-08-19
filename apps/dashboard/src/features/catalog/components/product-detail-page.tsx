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
  type ProductReadinessState,
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
import type {
  Application,
  Entitlement,
  Environment,
  Product,
  ProductUsage,
} from "@/generated/api";
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
  const {
    access,
    applications,
    archive,
    archiveMapping,
    connectedReadiness,
    connections,
    coverageIsPending,
    coverageRows,
    createMapping,
    environments,
    grants,
    hasExplicitReadinessScope,
    isArchived,
    mappingViews,
    manageProvidersHref,
    product,
    queryClient,
    readiness,
    replaceMapping,
    replacementOptions,
    restore,
    scopeMismatch,
    selectedReadinessApplication,
    selectedReadinessEnvironment,
    setReplacement,
    state,
    usage,
    usageCount,
  } = useProductDetailData({
    organizationId,
    productId,
    projectId,
    readinessApplicationId,
    readinessEnvironmentId,
  });

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
        <ProductMetricsRow
          hasExplicitReadinessScope={hasExplicitReadinessScope}
          product={product.data}
          readinessState={readiness.data?.state}
        />

        <MosaicOwnedProductPanel
          grantCount={grants.data?.items.length ?? 0}
          product={product.data}
        />

        <ReadinessScopePanel
          applications={applications.data?.items ?? []}
          environments={environments.data?.items ?? []}
          hasExplicitReadinessScope={hasExplicitReadinessScope}
          onReadinessScopeChange={onReadinessScopeChange}
          selectedApplication={selectedReadinessApplication}
          selectedEnvironment={selectedReadinessEnvironment}
        />

        <ProductPlatformCoverage
          connections={connections.data?.items ?? []}
          environment={selectedReadinessEnvironment}
          isLoading={coverageIsPending}
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

        <ProductUsagePanel usage={usage.data} />

        <AccessGrantsPanel
          canManage={access.canManage}
          grants={grants.data?.items ?? []}
          organizationId={organizationId}
          productId={productId}
          projectId={projectId}
        />

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

        <ProductLifecyclePanel
          canManage={access.canManage}
          error={archive.error ?? restore.error ?? setReplacement.error}
          isArchived={isArchived}
          onArchive={async () => {
            await archive.mutateAsync(productId);
          }}
          onRestore={() => restore.mutate(productId)}
          onSetReplacement={async (replacementProductId) => {
            await setReplacement.mutateAsync({
              previousReplacementProductId: product.data?.replacementProductId,
              replacementProductId,
            });
          }}
          organizationId={organizationId}
          pendingAction={lifecyclePendingAction({
            archiving: archive.isPending,
            savingReplacement: setReplacement.isPending,
          })}
          recordedReplacementId={product.data?.replacementProductId}
          replacementOptions={replacementOptions}
          usageCount={usageCount}
        />
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}

/**
 * Every read and write this page needs, in one unconditional sequence. The page
 * body below is a composition of panels, so the ordering that decides which
 * queries are enabled by the routed readiness scope lives here rather than
 * being spread across them.
 */
function useProductDetailData({
  organizationId,
  productId,
  projectId,
  readinessApplicationId,
  readinessEnvironmentId,
}: {
  organizationId: string;
  productId: string;
  projectId: string;
  readinessApplicationId?: string;
  readinessEnvironmentId?: string;
}) {
  const queryClient = useQueryClient();
  const access = useOrganizationAccess(organizationId);
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

  return {
    access,
    applications,
    archive,
    archiveMapping,
    connectedReadiness,
    connections,
    coverageIsPending: coverageReadinessQueries.some(
      (query) => query.isPending
    ),
    coverageRows,
    createMapping,
    environments,
    grants,
    hasExplicitReadinessScope,
    isArchived: product.data?.status === "archived",
    mappingViews,
    manageProvidersHref: `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`,
    product,
    queryClient,
    readiness,
    replaceMapping,
    replacementOptions: replacementCandidates(
      replacements.data?.items ?? [],
      productId,
      product.data?.type
    ),
    restore,
    scopeMismatch,
    selectedReadinessApplication,
    selectedReadinessEnvironment,
    setReplacement,
    state,
    usage,
    usageCount: countProductUsage(usage.data),
  };
}

function ProductMetricsRow({
  hasExplicitReadinessScope,
  product,
  readinessState,
}: {
  hasExplicitReadinessScope: boolean;
  product?: Product;
  readinessState?: ProductReadinessState;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Metric
        label="Status"
        value={product?.status.replaceAll("_", " ") ?? "—"}
      />
      <Metric
        label="Metadata"
        value={
          product?.metadataSource === "provider"
            ? "Provider-owned"
            : "Mock metadata"
        }
      />
      <Metric
        label="Readiness"
        value={(() => {
          if (readinessState) {
            return readinessStateLabel(readinessState);
          }
          if (hasExplicitReadinessScope) {
            return "Checking…";
          }
          return "Select scope";
        })()}
      />
    </div>
  );
}

function MosaicOwnedProductPanel({
  grantCount,
  product,
}: {
  grantCount: number;
  product?: Product;
}) {
  return (
    <WorkflowPanel
      description="These fields belong to Mosaic and remain stable when provider mappings or credentials change."
      title="Mosaic-owned Product"
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Internal name" value={product?.internalName ?? "—"} />
        <Metric label="Product key" value={product?.key ?? "—"} />
        <Metric
          label="Type"
          value={product?.type.replaceAll("_", " ") ?? "—"}
        />
        <Metric label="Entitlement grants" value={`${grantCount}`} />
      </dl>
      <p className="mt-4 text-muted-foreground text-sm">
        {product?.description || "No internal description."} Provider display
        names, localized prices, periods, offers, and availability are
        synchronized read-only evidence below and never overwrite this identity.
      </p>
    </WorkflowPanel>
  );
}

function ReadinessScopePanel({
  applications,
  environments,
  hasExplicitReadinessScope,
  onReadinessScopeChange,
  selectedApplication,
  selectedEnvironment,
}: {
  applications: readonly Application[];
  environments: readonly Environment[];
  hasExplicitReadinessScope: boolean;
  onReadinessScopeChange: (scope: {
    applicationId?: string;
    environmentId?: string;
  }) => void;
  selectedApplication?: Application;
  selectedEnvironment?: Environment;
}) {
  const environmentOptions = [
    { label: "Select Environment", value: "" },
    ...environments.map((environment) => ({
      label: `${environment.name} · ${environment.mode}`,
      value: environment.id,
    })),
  ];
  const applicationOptions = [
    { label: "Select Application", value: "" },
    ...applications.map((application) => ({
      label: `${application.name} · ${application.platform.toUpperCase()}`,
      value: application.id,
    })),
  ];
  return (
    <WorkflowPanel
      description="Choose one Environment and one registered Application. Mosaic does not fall back to project-wide or another platform’s readiness."
      title="Readiness scope"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="font-medium text-sm">
          <label htmlFor="readiness-environment">Environment</label>
          <Select
            items={environmentOptions}
            onValueChange={(value) =>
              onReadinessScopeChange({
                applicationId: selectedApplication?.id,
                environmentId: value || undefined,
              })
            }
            value={selectedEnvironment?.id ?? ""}
          >
            <SelectTrigger className="mt-2" id="readiness-environment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {environmentOptions.map((option) => (
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
            items={applicationOptions}
            onValueChange={(value) =>
              onReadinessScopeChange({
                applicationId: value || undefined,
                environmentId: selectedEnvironment?.id,
              })
            }
            value={selectedApplication?.id ?? ""}
          >
            <SelectTrigger className="mt-2" id="readiness-application">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {applicationOptions.map((option) => (
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
  );
}

function ProductUsagePanel({ usage }: { usage?: ProductUsage }) {
  return (
    <WorkflowPanel
      description="Usage is always shown before lifecycle controls. Historical references keep this Mosaic Product ID stable."
      title="Used in"
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <UsageList
          items={usage?.plans.map((item) => item.name) ?? []}
          label="Plans"
        />
        <UsageList
          items={usage?.entitlements.map((item) => item.name) ?? []}
          label="Access"
        />
        <UsageList
          items={
            usage?.providerMappings.map(
              (item) => `${item.provider}: ${item.providerProductIdentifier}`
            ) ?? []
          }
          label="Provider placeholders"
        />
        <UsageList
          items={usage?.historicalReferences ?? []}
          label="Historical references"
        />
      </div>
    </WorkflowPanel>
  );
}

/* Retired in Phase 9B.
   A grant used to be a single mutable row here, so removing an Entitlement
   changed what every past purchase of this Product had meant — one DELETE away
   from mass revocation, with no record that it had ever granted anything. What
   a Product grants is now a versioned, immutable interval selected by each
   purchase's own effective time, so the change surface moved to Grant versions
   and this panel reads. */
function AccessGrantsPanel({
  canManage,
  grants,
  organizationId,
  productId,
  projectId,
}: {
  canManage: boolean;
  grants: readonly Entitlement[];
  organizationId: string;
  productId: string;
  projectId: string;
}) {
  return (
    <WorkflowPanel
      description="What this Product grants, as it stands today. These definitions describe access a Product grants; they are not any customer's entitlement state."
      title="Access grants"
    >
      <ul className="mb-4 divide-y">
        {grants.map((entitlement) => (
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
        Changing what a Product grants publishes a new immutable grant version
        rather than editing this list. The projection engine selects a version
        by each purchase&rsquo;s own effective time, so a change made here would
        otherwise rewrite what someone was entitled to at an instant that has
        already passed.
      </p>
      {canManage ? (
        <a
          className={buttonVariants({ variant: "outline" })}
          href={
            grantVersionsHref({ organizationId, projectId }, { productId }) ??
            "#"
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
  );
}

/**
 * Archiving and saving a replacement are separate mutations the panel never
 * runs together — each disables the controls that could start the other — so
 * they arrive as one value rather than two booleans whose four combinations
 * include two this panel has no rendering for.
 */
type LifecyclePendingAction = "archiving" | "savingReplacement";

/** Saving a replacement is reported first: archiving waits on it. */
function lifecyclePendingAction(pending: {
  archiving: boolean;
  savingReplacement: boolean;
}): LifecyclePendingAction | undefined {
  if (pending.savingReplacement) {
    return "savingReplacement";
  }
  return pending.archiving ? "archiving" : undefined;
}

function ProductLifecyclePanel({
  canManage,
  error,
  isArchived,
  onArchive,
  onRestore,
  onSetReplacement,
  organizationId,
  pendingAction,
  recordedReplacementId,
  replacementOptions,
  usageCount,
}: {
  canManage: boolean;
  error: { message: string } | null;
  isArchived: boolean;
  pendingAction?: LifecyclePendingAction;
  onArchive: () => Promise<void>;
  onRestore: () => void;
  onSetReplacement: (replacementProductId: string) => Promise<void>;
  organizationId: string;
  recordedReplacementId?: string;
  replacementOptions: readonly Product[];
  usageCount: number;
}) {
  const [showLifecycle, setShowLifecycle] = useState(false);
  const [selectedReplacementId, setSelectedReplacementId] = useState<
    string | null
  >(null);
  const reviewArchive = useCallback(() => {
    setSelectedReplacementId(null);
    setShowLifecycle(true);
  }, []);
  const replacementSelectOptions = replacementOptions.map((item) => ({
    label: item.internalName,
    value: item.id,
  }));
  const effectiveReplacementId = selectedReplacementId ?? recordedReplacementId;
  const replacementNeedsSave = Boolean(
    selectedReplacementId && selectedReplacementId !== recordedReplacementId
  );

  const confirmArchive = useCallback(async () => {
    try {
      if (replacementNeedsSave && selectedReplacementId) {
        await onSetReplacement(selectedReplacementId);
      }
      await onArchive();
      setSelectedReplacementId(null);
      setShowLifecycle(false);
    } catch {
      // TanStack Mutation exposes the actionable API error in the workflow below.
    }
  }, [
    onArchive,
    onSetReplacement,
    replacementNeedsSave,
    selectedReplacementId,
  ]);

  const handleConfirmArchive = useCallback(() => {
    confirmArchive();
  }, [confirmArchive]);
  function cancelArchiveReview() {
    setSelectedReplacementId(null);
    setShowLifecycle(false);
  }

  return (
    <WorkflowPanel
      description="Archive removes this Product from future selection without deleting history. Restore preserves the same ID."
      title="Lifecycle"
    >
      {(() => {
        if (canManage) {
          return (() => {
            if (isArchived) {
              return (
                <Button onClick={onRestore} variant="outline">
                  <ArrowCounterClockwiseIcon aria-hidden size={16} />
                  Restore Product
                </Button>
              );
            }
            return (
              <Button onClick={reviewArchive} variant="outline">
                <ArchiveIcon aria-hidden size={16} />
                Review archive
              </Button>
            );
          })();
        }
        return (
          <a
            className="font-semibold text-primary text-sm"
            href={`/orgs/${encodeURIComponent(organizationId)}/members`}
          >
            Ask an Owner or Admin to change Product lifecycle
          </a>
        );
      })()}
      {showLifecycle && !isArchived ? (
        <div className="mt-4 rounded border border-border bg-muted/35 p-4">
          <p className="font-semibold text-sm">
            {usageCount > 0
              ? `This Product has ${usageCount} usage reference(s). Choose a replacement before archiving.`
              : "This Product has no known usage and can be archived safely."}
          </p>
          {usageCount > 0 ? (
            <div className="mt-3 flex max-w-md flex-col gap-2 font-medium text-sm">
              <label htmlFor="replacement-product">Replacement Product</label>
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
          {usageCount > 0 && recordedReplacementId ? (
            <p className="mt-2 text-muted-foreground text-sm">
              An existing replacement is already recorded. Choose another only
              if it should be changed before archive.
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
                pendingAction !== undefined ||
                !canConfirmProductArchive(
                  usageCount,
                  Boolean(effectiveReplacementId)
                )
              }
              onClick={handleConfirmArchive}
            >
              {(() => {
                if (pendingAction === "savingReplacement") {
                  return "Saving replacement…";
                }
                if (pendingAction === "archiving") {
                  return "Archiving…";
                }
                if (replacementNeedsSave) {
                  return "Save replacement and archive";
                }
                return "Archive Product";
              })()}
            </Button>
            <Button
              disabled={pendingAction !== undefined}
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
      {error ? (
        <p className="mt-3 text-destructive text-sm" role="alert">
          {error.message}
        </p>
      ) : null}
    </WorkflowPanel>
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
