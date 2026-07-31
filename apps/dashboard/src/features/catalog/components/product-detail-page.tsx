import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { ProductReadinessPanel } from "@/features/catalog/components/product-readiness-panel"
import { ProductPlatformCoverage } from "@/features/catalog/components/product-platform-coverage"
import { ProviderMappingsPanel } from "@/features/catalog/components/provider-mappings-panel"
import { NativeProviderMappingSheet } from "@/features/catalog/components/native-provider-mapping-sheet"
import {
  archiveProviderMappingMutationOptions,
  createProviderMappingDraftMutationOptions,
  grantEntitlementMutationOptions,
  productLifecycleMutationOptions,
  removeEntitlementGrantMutationOptions,
  replaceProviderMappingMutationOptions,
  setProductReplacementMutationOptions,
} from "@/features/catalog/mutations/catalog-mutations"
import {
  entitlementsQueryOptions,
  productEntitlementsQueryOptions,
  productQueryOptions,
  productReadinessQueryOptions,
  providerMappingMetadataQueryOptions,
  providerMappingObservationsQueryOptions,
  providerMappingUsageQueryOptions,
  productsQueryOptions,
  productUsageQueryOptions,
  providerMappingsQueryOptions,
} from "@/features/catalog/queries/catalog-query"
import {
  canConfirmProductArchive,
  countProductUsage,
  replacementCandidates,
} from "@/features/catalog/types/product-lifecycle"
import {
  productReadinessView,
  providerMappingView,
  readinessStateLabel,
} from "@/features/catalog/types/connected-product-view"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { detectNestedScopeMismatch } from "@/features/organizations/types/nested-scope"
import { providerConnectionsQueryOptions } from "@/features/provider-connections/queries/provider-connection-queries"
import {
  applicationsQueryOptions,
  projectQueryOptions,
} from "@/features/projects/queries/projects-query"
import { useOrganizationAccess } from "@/hooks/use-organization-access"
import { describeReturnDestination } from "@/lib/routing/workspace-hrefs"

interface ProductDetailPageProps {
  onReadinessScopeChange: (scope: { applicationId?: string; environmentId?: string }) => void
  organizationId: string
  productId: string
  projectId: string
  readinessApplicationId?: string
  readinessEnvironmentId?: string
  returnTo?: string
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
  const queryClient = useQueryClient()
  const access = useOrganizationAccess(organizationId)
  const [showLifecycle, setShowLifecycle] = useState(false)
  const [selectedReplacementId, setSelectedReplacementId] = useState<string | null>(null)
  const project = useQuery(projectQueryOptions(projectId))
  const product = useQuery(productQueryOptions(productId))
  const scopeMismatch = detectNestedScopeMismatch({
    expectedOrganizationId: organizationId,
    expectedProjectId: projectId,
    expectedResourceId: productId,
    project: project.data,
    resource: product.data,
  })
  const scopeReady = project.isSuccess && product.isSuccess && scopeMismatch === null
  const usage = useQuery({ ...productUsageQueryOptions(productId), enabled: scopeReady })
  const mappings = useQuery({ ...providerMappingsQueryOptions(productId), enabled: scopeReady })
  const metadataQueries = useQueries({
    queries: (mappings.data?.items ?? []).map((mapping) => ({
      ...providerMappingMetadataQueryOptions(mapping.id),
      enabled: scopeReady && Boolean(mapping.currentSnapshotId) && mapping.status !== "archived",
    })),
  })
  const observationQueries = useQueries({
    queries: (mappings.data?.items ?? []).map((mapping) => ({
      ...providerMappingObservationsQueryOptions(mapping.id),
      enabled:
        scopeReady && (mapping.provider === "app_store" || mapping.provider === "google_play"),
    })),
  })
  const grants = useQuery({ ...productEntitlementsQueryOptions(productId), enabled: scopeReady })
  const entitlements = useQuery({ ...entitlementsQueryOptions(projectId), enabled: scopeReady })
  const replacements = useQuery({ ...productsQueryOptions(projectId), enabled: scopeReady })
  const applications = useQuery({ ...applicationsQueryOptions(projectId), enabled: scopeReady })
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const connections = useQuery({
    ...providerConnectionsQueryOptions(projectId),
    enabled: scopeReady,
  })
  const selectedReadinessApplication = applications.data?.items.find(
    (application) => application.id === readinessApplicationId,
  )
  const selectedReadinessEnvironment = environments.data?.items.find(
    (environment) => environment.id === readinessEnvironmentId,
  )
  const hasExplicitReadinessScope = Boolean(
    selectedReadinessApplication && selectedReadinessEnvironment,
  )
  const readiness = useQuery({
    ...productReadinessQueryOptions(
      productId,
      readinessEnvironmentId ?? "unselected",
      readinessApplicationId ?? "unselected",
    ),
    enabled: scopeReady && hasExplicitReadinessScope,
  })
  const coverageReadinessQueries = useQueries({
    queries: (applications.data?.items ?? []).map((application) => ({
      ...productReadinessQueryOptions(
        productId,
        readinessEnvironmentId ?? "unselected",
        application.id,
      ),
      enabled: scopeReady && Boolean(selectedReadinessEnvironment),
    })),
  })
  const archive = useMutation(productLifecycleMutationOptions(queryClient, "archive"))
  const restore = useMutation(productLifecycleMutationOptions(queryClient, "restore"))
  const setReplacement = useMutation(setProductReplacementMutationOptions(productId, queryClient))
  const grant = useMutation(grantEntitlementMutationOptions(productId, projectId, queryClient))
  const removeGrant = useMutation(
    removeEntitlementGrantMutationOptions(productId, projectId, queryClient),
  )
  const archiveMapping = useMutation(
    archiveProviderMappingMutationOptions(productId, projectId, queryClient),
  )
  const createMapping = useMutation(
    createProviderMappingDraftMutationOptions(productId, projectId, queryClient),
  )
  const replaceMapping = useMutation(
    replaceProviderMappingMutationOptions(productId, projectId, queryClient),
  )
  const error =
    project.error ??
    product.error ??
    usage.error ??
    readiness.error ??
    mappings.error ??
    applications.error ??
    environments.error ??
    connections.error ??
    access.error
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
      void project.refetch()
      void product.refetch()
      void usage.refetch()
      if (hasExplicitReadinessScope) void readiness.refetch()
      void mappings.refetch()
      void applications.refetch()
      void environments.refetch()
      void connections.refetch()
    },
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={{ organizationId, projectId }}
        to="/organizations/$organizationId/projects/$projectId"
      >
        Return to Project
      </Link>
    ),
    permissionDescription: "Project membership is required to inspect Product usage.",
    scope: { organizationId, projectId },
  })
  const usageCount = countProductUsage(usage.data)
  const isArchived = product.data?.status === "archived"
  const replacementOptions = replacementCandidates(
    replacements.data?.items ?? [],
    productId,
    product.data?.type,
  )
  const effectiveReplacementId = selectedReplacementId ?? product.data?.replacementProductId
  const replacementNeedsSave = Boolean(
    selectedReplacementId && selectedReplacementId !== product.data?.replacementProductId,
  )
  const connectedReadiness = readiness.data ? productReadinessView(readiness.data) : null
  const mappingViews =
    mappings.data?.items.map((mapping, index) =>
      providerMappingView(
        mapping,
        applications.data?.items ?? [],
        environments.data?.items ?? [],
        connections.data?.items ?? [],
        metadataQueries[index]?.data,
        observationQueries[index]?.data,
      ),
    ) ?? []
  const coverageRows =
    applications.data?.items.map((application, index) => {
      const applicationReadiness = coverageReadinessQueries[index]?.data
      return {
        application,
        readiness: applicationReadiness,
        mapping: applicationReadiness?.mappingId
          ? mappings.data?.items.find((mapping) => mapping.id === applicationReadiness.mappingId)
          : undefined,
      }
    }) ?? []
  const manageProvidersHref = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`

  async function confirmArchive() {
    try {
      if (replacementNeedsSave && selectedReplacementId) {
        await setReplacement.mutateAsync({
          previousReplacementProductId: product.data?.replacementProductId,
          replacementProductId: selectedReplacementId,
        })
      }
      await archive.mutateAsync(productId)
      setSelectedReplacementId(null)
      setShowLifecycle(false)
    } catch {
      // TanStack Mutation exposes the actionable API error in the workflow below.
    }
  }

  function cancelArchiveReview() {
    setSelectedReplacementId(null)
    setShowLifecycle(false)
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
    )
  }

  return (
    <WorkspacePage
      description={product.data?.description ?? "Stable provider-neutral Product identity."}
      eyebrow="Catalog · Product"
      title={product.data?.internalName ?? "Product"}
    >
      <HostedResourceBoundary state={state}>
        {returnTo ? (
          <a className="text-primary inline-flex text-sm font-semibold" href={returnTo}>
            {describeReturnDestination(returnTo)}
          </a>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="Status" value={product.data?.status.replaceAll("_", " ") ?? "—"} />
          <Metric
            label="Metadata"
            value={product.data?.metadataSource === "provider" ? "Provider-owned" : "Mock metadata"}
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
            <Metric label="Internal name" value={product.data?.internalName ?? "—"} />
            <Metric label="Product key" value={product.data?.key ?? "—"} />
            <Metric label="Type" value={product.data?.type.replaceAll("_", " ") ?? "—"} />
            <Metric label="Entitlement grants" value={`${grants.data?.items.length ?? 0}`} />
          </dl>
          <p className="text-muted-foreground mt-4 text-sm">
            {product.data?.description || "No internal description."} Provider display names,
            localized prices, periods, offers, and availability are synchronized read-only evidence
            below and never overwrite this identity.
          </p>
        </WorkflowPanel>

        <WorkflowPanel
          description="Choose one Environment and one registered Application. Mosaic does not fall back to project-wide or another platform’s readiness."
          title="Readiness scope"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Environment
              <select
                className="border-input bg-background mt-2 h-9 w-full rounded border px-3"
                onChange={(event) =>
                  onReadinessScopeChange({
                    applicationId: selectedReadinessApplication?.id,
                    environmentId: event.currentTarget.value || undefined,
                  })
                }
                value={selectedReadinessEnvironment?.id ?? ""}
              >
                <option value="">Select Environment</option>
                {environments.data?.items.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name} · {environment.mode}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Application
              <select
                className="border-input bg-background mt-2 h-9 w-full rounded border px-3"
                onChange={(event) =>
                  onReadinessScopeChange({
                    applicationId: event.currentTarget.value || undefined,
                    environmentId: selectedReadinessEnvironment?.id,
                  })
                }
                value={selectedReadinessApplication?.id ?? ""}
              >
                <option value="">Select Application</option>
                {applications.data?.items.map((application) => (
                  <option key={application.id} value={application.id}>
                    {application.name} · {application.platform.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!hasExplicitReadinessScope ? (
            <p className="text-muted-foreground mt-3 text-xs">
              Readiness is not requested until both scope values are explicitly selected.
            </p>
          ) : null}
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
            applicationsHref={`/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/apps`}
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
            <UsageList items={usage.data?.plans.map((item) => item.name) ?? []} label="Plans" />
            <UsageList
              items={usage.data?.entitlements.map((item) => item.name) ?? []}
              label="Access"
            />
            <UsageList
              items={
                usage.data?.providerMappings.map(
                  (item) => `${item.provider}: ${item.providerProductIdentifier}`,
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

        <WorkflowPanel
          description="These definitions describe access a Product grants. They are not customer entitlement state."
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
                  <span className="text-muted-foreground font-mono text-xs">
                    · {entitlement.key}
                  </span>
                </span>
                {access.canManage ? (
                  <Button
                    disabled={removeGrant.isPending}
                    onClick={() => removeGrant.mutate(entitlement.id)}
                    size="sm"
                    variant="ghost"
                  >
                    Remove grant
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {access.canManage ? (
            <div className="flex flex-wrap gap-2">
              {entitlements.data?.items
                .filter(
                  (entitlement) =>
                    !grants.data?.items.some((granted) => granted.id === entitlement.id),
                )
                .map((entitlement) => (
                  <Button
                    key={entitlement.id}
                    onClick={() => grant.mutate(entitlement.id)}
                    size="sm"
                    variant="outline"
                  >
                    Grant {entitlement.name}
                  </Button>
                ))}
            </div>
          ) : (
            <a
              className="text-primary text-sm font-semibold"
              href={`/organizations/${encodeURIComponent(organizationId)}/members`}
            >
              Ask an Owner or Admin to change Access grants
            </a>
          )}
          {grant.error || removeGrant.error ? (
            <p className="text-destructive mt-3 text-sm" role="alert">
              {(grant.error ?? removeGrant.error)?.message}
            </p>
          ) : null}
        </WorkflowPanel>

        <ProviderMappingsPanel
          canManage={access.canManage}
          error={archiveMapping.error ?? replaceMapping.error ?? createMapping.error}
          isPending={
            archiveMapping.isPending || replaceMapping.isPending || createMapping.isPending
          }
          onLoadUsage={(mappingId) =>
            queryClient.fetchQuery(providerMappingUsageQueryOptions(mappingId))
          }
          manageProvidersHref={manageProvidersHref}
          membersHref={`/organizations/${encodeURIComponent(organizationId)}/members`}
          mappings={mappingViews}
          onArchive={async (mappingId) => {
            await archiveMapping.mutateAsync(mappingId)
          }}
          onReplace={async (mappingId, body) => {
            await replaceMapping.mutateAsync({ body, mappingId })
          }}
          productType={product.data?.type}
        />

        {access.canManage &&
        product.data &&
        selectedReadinessApplication &&
        selectedReadinessEnvironment &&
        (readiness.data?.provider === "app_store" || readiness.data?.provider === "google_play") ? (
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
                  ...(input.googleOfferId ? { providerOfferIdentifier: input.googleOfferId } : {}),
                })
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
          {!access.canManage ? (
            <a
              className="text-primary text-sm font-semibold"
              href={`/organizations/${encodeURIComponent(organizationId)}/members`}
            >
              Ask an Owner or Admin to change Product lifecycle
            </a>
          ) : isArchived ? (
            <Button onClick={() => restore.mutate(productId)} variant="outline">
              <ArrowCounterClockwiseIcon aria-hidden size={16} />
              Restore Product
            </Button>
          ) : (
            <Button
              onClick={() => {
                setSelectedReplacementId(null)
                setShowLifecycle(true)
              }}
              variant="outline"
            >
              <ArchiveIcon aria-hidden size={16} />
              Review archive
            </Button>
          )}
          {showLifecycle && !isArchived ? (
            <div className="border-border bg-muted/35 mt-4 rounded border p-4">
              <p className="text-sm font-semibold">
                {usageCount > 0
                  ? `This Product has ${usageCount} usage reference(s). Choose a replacement before archiving.`
                  : "This Product has no known usage and can be archived safely."}
              </p>
              {usageCount > 0 ? (
                <label className="mt-3 flex max-w-md flex-col gap-2 text-sm font-medium">
                  Replacement Product
                  <select
                    className="border-input bg-background h-9 rounded border px-3"
                    onChange={(event) => setSelectedReplacementId(event.target.value || null)}
                    value={effectiveReplacementId ?? ""}
                  >
                    <option disabled value="">
                      Choose an active Product
                    </option>
                    {replacementOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.internalName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {usageCount > 0 && product.data?.replacementProductId ? (
                <p className="text-muted-foreground mt-2 text-sm">
                  An existing replacement is already recorded. Choose another only if it should be
                  changed before archive.
                </p>
              ) : null}
              {usageCount > 0 && replacementOptions.length === 0 && !effectiveReplacementId ? (
                <div className="mt-4">
                  <Link
                    className={buttonVariants({ variant: "outline" })}
                    params={{ organizationId, projectId }}
                    to="/organizations/$organizationId/projects/$projectId/catalog/products"
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
                    !canConfirmProductArchive(usageCount, Boolean(effectiveReplacementId))
                  }
                  onClick={() => void confirmArchive()}
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
          <p className="text-muted-foreground mt-4 text-sm">
            Destructive deletion is unavailable once referenced. Archive, replacement, and restore
            are the recovery paths.
          </p>
          {archive.error || restore.error || setReplacement.error ? (
            <p className="text-destructive mt-3 text-sm" role="alert">
              {(archive.error ?? restore.error ?? setReplacement.error)?.message}
            </p>
          ) : null}
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-4">
      <p className="text-muted-foreground text-xs font-medium uppercase">{label}</p>
      <p className="mt-2 text-sm font-semibold capitalize">{value}</p>
    </div>
  )
}
function UsageList({ items, label }: { items: string[]; label: string }) {
  return (
    <section aria-label={label}>
      <p className="text-xs font-semibold tracking-wide uppercase">{label}</p>
      {items.length ? (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li className="text-muted-foreground text-sm" key={item}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-2 text-sm">None</p>
      )}
    </section>
  )
}
