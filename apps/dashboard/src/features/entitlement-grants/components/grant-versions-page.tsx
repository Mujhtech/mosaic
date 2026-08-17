import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/feedback/empty-state";
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
import {
  DefinitionRow,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome";
import { formatBillingTimestamp } from "@/features/billing-ledger/types/billing-vocabulary";
import {
  entitlementsQueryOptions,
  productsQueryOptions,
} from "@/features/catalog/queries/catalog-query";
import { PublishGrantVersionWizard } from "@/features/entitlement-grants/components/publish-grant-version-wizard";
import {
  previewGrantImpactMutationOptions,
  publishGrantVersionMutationOptions,
} from "@/features/entitlement-grants/mutations/grant-version-mutations";
import { grantVersionHistoryQueryOptions } from "@/features/entitlement-grants/queries/grant-version-queries";
import {
  grantPolicyFields,
  grantPolicyLabel,
} from "@/features/entitlement-grants/types/grant-version-view";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import type { ProductEntitlementGrantVersion } from "@/generated/api";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import { catalogProductsHref } from "@/lib/routing/workspace-hrefs";

interface GrantVersionsPageProps {
  entitlementId?: string;
  onScopeChange: (scope: {
    entitlementId?: string;
    productId?: string;
  }) => void;
  organizationId: string;
  productId?: string;
  projectId: string;
}

/**
 * What a Product grants, over time.
 *
 * This surface replaces the Phase 9A grant/revoke buttons on Product detail. A
 * grant was a single mutable row there, so removing an Entitlement changed what
 * every past purchase had meant — one DELETE away from mass revocation. Here a
 * change is a new immutable interval, and history stays readable, which is what
 * makes "why is this customer entitled?" answerable for a purchase made under a
 * rule that has since been replaced.
 */
export function GrantVersionsPage({
  entitlementId,
  onScopeChange,
  organizationId,
  productId,
  projectId,
}: GrantVersionsPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const access = useOrganizationAccess(organizationId);
  const queryClient = useQueryClient();
  const products = useQuery({
    ...productsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const entitlements = useQuery({
    ...entitlementsQueryOptions(projectId),
    enabled: scopeReady,
  });

  const productItems = products.data?.items ?? [];
  const selectedProductId = productId ?? productItems[0]?.id;
  const versions = useQuery({
    ...grantVersionHistoryQueryOptions(
      projectId,
      selectedProductId ?? "",
      entitlementId
    ),
    enabled: scopeReady && Boolean(selectedProductId),
  });

  const preview = useMutation(previewGrantImpactMutationOptions(projectId));
  const publish = useMutation(
    publishGrantVersionMutationOptions(projectId, queryClient)
  );

  const error =
    project.error ?? products.error ?? entitlements.error ?? versions.error;
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending:
      project.isPending ||
      (scopeReady && (products.isPending || entitlements.isPending)),
    loadingDescription: "Loading grant version history for this Project.",
    onRetry: () => {
      versions.refetch();
    },
    permissionDescription:
      "Membership of the owning Organization is required to read grant version history.",
    scope: { organizationId, projectId },
  });

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Grant versions unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  const productsHref =
    catalogProductsHref({ organizationId, projectId }) ?? "#";
  const productOptions = productItems.map((product) => ({
    label: product.internalName,
    value: product.id,
  }));
  const entitlementOptions = [
    { label: "All Entitlements", value: "" },
    ...(entitlements.data?.items ?? []).map((entitlement) => ({
      label: entitlement.name,
      value: entitlement.id,
    })),
  ];
  const grouped = groupByEntitlement(versions.data ?? []);

  return (
    <WorkspacePage
      description="Every version of what a Product grants, newest first. The projection engine selects a version by each purchase's own effective time, so this history is how an entitlement derived under a replaced rule is explained."
      eyebrow="Catalog · Grant versions"
      title="Grant versions"
    >
      <p className="text-muted-foreground text-xs leading-5">
        Published versions are immutable. Intervals are half-open and abut
        exactly, so every instant is covered by at most one version per
        Entitlement — never a gap that would strand a purchase with no
        applicable grant, never an overlap that would make the applicable
        version a function of row order.
      </p>

      <HostedResourceBoundary state={state}>
        {productItems.length === 0 ? (
          <EmptyState
            action={
              <a className={buttonVariants()} href={productsHref}>
                Open Products
              </a>
            }
            description="Grant versions describe what a Product grants, so this Project needs at least one Product before there is anything to version."
            title="No Products in this Project yet"
          />
        ) : (
          <>
            <WorkflowPanel title="Scope">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="text-sm">
                  <label
                    className="block text-muted-foreground text-xs"
                    htmlFor="grant-scope-product"
                  >
                    Product
                  </label>
                  <Select
                    items={productOptions}
                    onValueChange={(value) =>
                      onScopeChange({ entitlementId, productId: value })
                    }
                    value={selectedProductId ?? ""}
                  >
                    <SelectTrigger className="mt-1" id="grant-scope-product">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {productOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-sm">
                  <label
                    className="block text-muted-foreground text-xs"
                    htmlFor="grant-scope-entitlement"
                  >
                    Entitlement
                  </label>
                  <Select
                    items={entitlementOptions}
                    onValueChange={(value) =>
                      onScopeChange({
                        entitlementId: value || undefined,
                        productId: selectedProductId,
                      })
                    }
                    value={entitlementId ?? ""}
                  >
                    <SelectTrigger
                      className="mt-1"
                      id="grant-scope-entitlement"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {entitlementOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4">
                <PublishGrantVersionWizard
                  canManage={access.canManage}
                  entitlementId={
                    entitlementId ?? entitlements.data?.items[0]?.id ?? ""
                  }
                  entitlements={entitlements.data?.items ?? []}
                  onPreview={(proposal) => preview.mutateAsync(proposal)}
                  onPublish={async (proposal) => {
                    await publish.mutateAsync(proposal);
                  }}
                  productId={selectedProductId ?? ""}
                  products={productItems}
                />
                {access.canManage ? null : (
                  <a
                    className="mt-2 inline-flex font-semibold text-primary text-sm"
                    href={`/orgs/${encodeURIComponent(organizationId)}/members`}
                  >
                    Ask an Owner or Admin to change what this Product grants
                  </a>
                )}
              </div>
            </WorkflowPanel>

            {grouped.length === 0 ? (
              <EmptyState
                description="No grant version has been published for this Product yet, so it grants nothing and no purchase of it produces an Entitlement."
                title="No grant versions for this Product"
              />
            ) : (
              grouped.map(([key, items]) => (
                <WorkflowPanel
                  description="Newest version first. The version in force now has no end."
                  key={key}
                  title={`${items[0]?.entitlementKey ?? key} · ${items.length} version(s)`}
                >
                  <ul className="space-y-3">
                    {items.map((version) => (
                      <li
                        className="rounded border p-4"
                        key={version.grantVersionId}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm">
                            Version {version.version}
                          </span>
                          {version.current ? (
                            <StatusPill label="In force now" tone="positive" />
                          ) : (
                            <StatusPill
                              label="Closed interval"
                              tone="neutral"
                            />
                          )}
                          {version.retroactive ? (
                            <StatusPill label="Backdated" tone="attention" />
                          ) : null}
                          <StatusPill label="Immutable" tone="neutral" />
                        </div>
                        <dl className="mt-3">
                          <DefinitionRow
                            label="Effective from"
                            value={formatBillingTimestamp(
                              version.effectiveStart
                            )}
                          />
                          <DefinitionRow
                            label="Effective until"
                            value={
                              version.effectiveEnd
                                ? formatBillingTimestamp(version.effectiveEnd)
                                : "In force now — no end"
                            }
                          />
                          <DefinitionRow
                            label="Grants access during"
                            value={describePolicy(version)}
                          />
                          <DefinitionRow
                            label="Purchase types"
                            value={
                              (version.supportedPurchaseTypes ?? []).join(
                                ", "
                              ) || "—"
                            }
                          />
                          <DefinitionRow
                            label="Reason"
                            value={version.reason ?? "—"}
                          />
                          <DefinitionRow
                            label="Published"
                            value={formatBillingTimestamp(version.createdAt)}
                          />
                        </dl>
                        <p className="mt-3 text-muted-foreground text-xs leading-5">
                          This version cannot be edited or deleted. A purchase
                          made inside its interval is still explained by it, so
                          changing it would change what someone was entitled to
                          at an instant that has already passed. Publish a new
                          version instead.
                        </p>
                      </li>
                    ))}
                  </ul>
                </WorkflowPanel>
              ))
            )}
          </>
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}

function groupByEntitlement(
  versions: readonly ProductEntitlementGrantVersion[]
) {
  const groups = new Map<string, ProductEntitlementGrantVersion[]>();
  for (const version of versions) {
    const key = version.entitlementId ?? "unknown";
    groups.set(key, [...(groups.get(key) ?? []), version]);
  }
  for (const items of groups.values()) {
    items.sort((left, right) => (right.version ?? 0) - (left.version ?? 0));
  }
  return [...groups.entries()];
}

function describePolicy(version: ProductEntitlementGrantVersion) {
  const policy = version.accessPolicy ?? {};
  const granted = grantPolicyFields.flatMap((field) =>
    policy[field] === true ? [grantPolicyLabel(field)] : []
  );
  return granted.length > 0
    ? granted.join(", ")
    : "Nothing — this version grants no access";
}
