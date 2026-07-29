import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import {
  DefinitionRow,
  EnvironmentBadges,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome"
import { providerLabel } from "@/features/billing-ledger/types/billing-vocabulary"
import { EntitlementExplanationPanel } from "@/features/billing-customers/components/entitlement-explanation-panel"
import { requestCustomerSyncMutationOptions } from "@/features/billing-customers/mutations/customer-mutations"
import {
  billingCustomerQueryOptions,
  customerEntitlementSnapshotQueryOptions,
} from "@/features/billing-customers/queries/customer-queries"
import {
  aliasTypeLabel,
  aliasTypeNote,
  AUTHORITATIVE_ACCESS_NOTE,
  AUTHORITATIVE_TIMESTAMP_NOTE,
  customerDiagnosticsLabel,
  customerIdentityExplanation,
  customerIdentityLabel,
  customerStatusLabel,
  customerStatusTone,
  formatEntitlementInstant,
  lineageDiagnosticLabel,
  oneTimeValidityLabel,
  oneTimeValidityTone,
  PROJECTION_FROZEN_NOTE,
  projectionStatusExplanation,
  projectionStatusLabel,
  projectionStatusTone,
  sourceAuthorityLabel,
  verificationStatusLabel,
} from "@/features/billing-customers/types/entitlement-vocabulary"
import { SubscriptionStateAxes } from "@/features/billing-customers/components/subscription-state-axes"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import {
  ScopeBadge,
  WorkflowPanel,
  WorkspacePage,
} from "@/features/organizations/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { useOrganizationAccess } from "@/hooks/use-organization-access"
import {
  billingCustomersHref,
  billingIdentityConflictHref,
  billingRestoresHref,
  billingSubscriptionHref,
  catalogProductHref,
} from "@/lib/routing/workspace-hrefs"

interface CustomerDetailPageProps {
  customerId: string
  environmentId: string
  organizationId: string
  projectId: string
}

/**
 * One Billing Customer's authoritative state.
 *
 * The header carries both scopes because they genuinely differ: identity is
 * Project-wide, everything computed about access is Environment-scoped. An
 * operator who assumes one scope for both will conclude a customer has no
 * access when they are simply looking at the wrong Environment.
 */
export function CustomerDetailPage({
  customerId,
  environmentId,
  organizationId,
  projectId,
}: CustomerDetailPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const access = useOrganizationAccess(organizationId)
  const queryClient = useQueryClient()
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const detail = useQuery({
    ...billingCustomerQueryOptions(projectId, environmentId, customerId),
    enabled: scopeReady,
  })
  const snapshot = useQuery({
    ...customerEntitlementSnapshotQueryOptions(projectId, environmentId, customerId),
    enabled: scopeReady,
  })
  const sync = useMutation(
    requestCustomerSyncMutationOptions(projectId, environmentId, customerId, queryClient),
  )

  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ?? environmentId
  const customer = detail.data?.customer
  const projectionStatus = snapshot.data?.projectionStatus ?? detail.data?.projectionStatus
  const currentSnapshot = snapshot.data?.snapshot ?? detail.data?.currentSnapshot

  const error = project.error ?? environments.error ?? detail.error
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending: project.isPending || (scopeReady && (environments.isPending || detail.isPending)),
    loadingDescription: "Loading this Billing Customer's authoritative state.",
    onRetry: () => {
      void detail.refetch()
      void snapshot.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to read a Billing Customer.",
    scope: { environmentId, organizationId, projectId },
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Billing Customer unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  const scope = { environmentId, organizationId, projectId }

  return (
    <WorkspacePage
      description="Everything Mosaic has computed about this customer's access in this Mosaic Environment, and the evidence it computed it from."
      eyebrow="Mosaic Billing · Customer"
      title={customerId}
    >
      <a className="text-primary text-sm font-semibold" href={billingCustomersHref(scope) ?? "#"}>
        Back to Customers
      </a>

      <p className="text-muted-foreground text-xs leading-5">{AUTHORITATIVE_ACCESS_NOTE}</p>

      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Customer">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              label={customerStatusLabel(customer?.status)}
              tone={customerStatusTone(customer?.status)}
            />
            <StatusPill label={customerIdentityLabel(customer ?? {})} tone="neutral" />
            {customer?.hasOpenIdentityConflict ? (
              <StatusPill label="Open identity conflict" tone="attention" />
            ) : null}
            {customer?.diagnosticsStatus && customer.diagnosticsStatus !== "none" ? (
              <StatusPill
                label={customerDiagnosticsLabel(customer.diagnosticsStatus)}
                tone="attention"
              />
            ) : null}
          </div>

          <p className="mt-3 text-sm leading-6">{customerIdentityExplanation(customer ?? {})}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ScopeBadge>
              <span className="text-muted-foreground/80 mr-1">Identity scope:</span>
              Project-wide
            </ScopeBadge>
            <ScopeBadge>
              <span className="text-muted-foreground/80 mr-1">Access scope:</span>
              {environmentName}
            </ScopeBadge>
          </div>

          {/* As of and last projected are two clocks, exactly as occurred-at and
              recorded-at are on the ledger. Merging them would hide a projection
              that ran recently but reasoned about a stale instant. */}
          <dl className="mt-3">
            <DefinitionRow
              label="Current snapshot version"
              value={
                customer?.snapshotVersion === undefined
                  ? "Never projected in this Environment"
                  : String(customer.snapshotVersion)
              }
            />
            <DefinitionRow
              label="As of (the instant the projection reasoned about)"
              value={formatEntitlementInstant(currentSnapshot?.asOf)}
            />
            <DefinitionRow
              label="Last projected at (when the run committed)"
              value={formatEntitlementInstant(
                projectionStatus?.lastProjectedAt ?? customer?.lastProjectedAt,
              )}
            />
            <DefinitionRow
              label="Projection rule version"
              value={String(currentSnapshot?.projectionRuleVersion ?? "—")}
            />
          </dl>
          <p className="text-muted-foreground mt-2 text-xs leading-5">
            {AUTHORITATIVE_TIMESTAMP_NOTE}
          </p>
        </WorkflowPanel>

        <WorkflowPanel title="Projection status">
          <StatusPill
            label={projectionStatusLabel(projectionStatus?.state)}
            tone={projectionStatusTone(projectionStatus?.state)}
          />
          <p className="mt-2 text-sm leading-6">
            {projectionStatusExplanation(projectionStatus?.state)}
          </p>
          {projectionStatus?.pendingFactCount ? (
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              {projectionStatus.pendingFactCount} fact(s) recorded but not yet projected. Until they
              are, entries derived from them read undetermined rather than inactive.
            </p>
          ) : null}

          {access.canManage ? (
            <div className="mt-4">
              {/* Deliberately not called "restore". No operator action can make
                  a store replay a person's purchases; this recomputes access
                  from facts Mosaic already holds. */}
              <Button disabled={sync.isPending} onClick={() => sync.mutate()} type="button">
                {sync.isPending ? "Queueing…" : "Recompute projection"}
              </Button>
              <p className="text-muted-foreground mt-2 text-xs leading-5">
                Queues a recomputation of this customer&rsquo;s committed access from the facts
                Mosaic already holds. It is not a device restore and cannot pull purchases from a
                store — for that, see{" "}
                <a className="text-primary font-semibold" href={billingRestoresHref(scope) ?? "#"}>
                  restores
                </a>
                . Requests coalesce, so clicking twice produces one projection.
              </p>
              {sync.isSuccess ? (
                <p className="mt-2 text-sm leading-6" role="status">
                  Queued. The snapshot version moves once the projection commits; a projection that
                  changes nothing does not advance it.
                </p>
              ) : null}
              {sync.error ? (
                <p className="text-destructive mt-2 text-sm" role="alert">
                  {sync.error.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </WorkflowPanel>

        {(detail.data?.identityConflicts ?? []).length > 0 ? (
          <WorkflowPanel
            description="While a conflict is open the disputed subject is frozen and neither candidate is granted anything, so everything else on this page is the last committed state rather than the current one."
            title="Identity conflicts"
          >
            <ul className="space-y-2">
              {(detail.data?.identityConflicts ?? []).map((conflict) => (
                <li className="rounded border p-3" key={conflict.conflictId}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <a
                      className="text-primary font-mono text-sm font-semibold break-all"
                      href={billingIdentityConflictHref(scope, conflict.conflictId ?? "") ?? "#"}
                    >
                      {conflict.conflictId}
                    </a>
                    <StatusPill
                      label={conflict.status === "open" ? "Open" : "Resolved"}
                      tone={conflict.status === "open" ? "attention" : "neutral"}
                    />
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Scope {conflict.scope ?? "—"} · opened{" "}
                    {formatEntitlementInstant(conflict.openedAt)}
                  </p>
                </li>
              ))}
            </ul>
          </WorkflowPanel>
        ) : null}

        <EntitlementExplanationPanel scope={scope} snapshot={currentSnapshot} />

        <WorkflowPanel
          description="Types and protected representations only. There is no alias value and no alias digest on this surface: a digest is still a stable per-person identifier, so rendering one would recreate the tracking key digest-only storage exists to avoid."
          title="Aliases"
        >
          {(detail.data?.aliases ?? []).length === 0 ? (
            <p className="text-sm leading-6">
              No alias is recorded. For a purchase-anchored customer that is expected: the purchase
              is anchored to the store&rsquo;s own chain, not to a person.
            </p>
          ) : (
            <ul className="space-y-2">
              {(detail.data?.aliases ?? []).map((alias) => (
                <li className="rounded border p-3" key={alias.aliasId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{aliasTypeLabel(alias.aliasType)}</span>
                    <StatusPill
                      label={verificationStatusLabel(alias.verificationStatus)}
                      tone={alias.verificationStatus === "verified" ? "positive" : "neutral"}
                    />
                    <StatusPill
                      label={alias.active ? "Active" : "Ended"}
                      tone={alias.active ? "positive" : "neutral"}
                    />
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {sourceAuthorityLabel(alias.sourceAuthority)} ·{" "}
                    {formatEntitlementInstant(alias.effectiveStart)}
                    {alias.effectiveEnd
                      ? ` → ${formatEntitlementInstant(alias.effectiveEnd)}`
                      : " → active"}
                  </p>
                  {aliasTypeNote(alias.aliasType) ? (
                    <p className="text-muted-foreground mt-1 text-xs leading-5">
                      {aliasTypeNote(alias.aliasType)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </WorkflowPanel>

        <WorkflowPanel
          description="The store-account-derived anchors a purchase belongs to. They survive reinstall, clear-data, and device changes, which is what lets a reinstalling customer resolve back to the same purchases."
          title="Purchase lineages"
        >
          {(detail.data?.purchaseLineages ?? []).length === 0 ? (
            <p className="text-sm leading-6">
              No purchase lineage is recorded for this customer in this Mosaic Environment.
            </p>
          ) : (
            <ul className="space-y-2">
              {(detail.data?.purchaseLineages ?? []).map((lineage) => (
                <li className="rounded border p-3" key={lineage.purchaseLineageId}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs break-all">{lineage.purchaseLineageId}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill label={providerLabel(lineage.provider)} tone="neutral" />
                      {lineage.projectionFrozen ? (
                        <StatusPill label="Projection frozen" tone="attention" />
                      ) : null}
                      {lineage.diagnosticStatus && lineage.diagnosticStatus !== "none" ? (
                        <StatusPill
                          label={lineageDiagnosticLabel(lineage.diagnosticStatus)}
                          tone="attention"
                        />
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2">
                    <EnvironmentBadges
                      mosaicEnvironmentName={environmentName}
                      storeEnvironment={lineage.storeEnvironment}
                    />
                  </div>
                  {lineage.projectionFrozen ? (
                    <p className="text-muted-foreground mt-2 text-xs leading-5">
                      {PROJECTION_FROZEN_NOTE}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </WorkflowPanel>

        <WorkflowPanel
          description="Five separate state axes per subscription. They are never merged into one status, because a cancelled subscription that still has access cannot be stated by a single word."
          title="Subscriptions"
        >
          {(detail.data?.subscriptions ?? []).length === 0 ? (
            <p className="text-sm leading-6">
              No Subscription Instance is projected for this customer in this Mosaic Environment.
            </p>
          ) : (
            <ul className="space-y-3">
              {(detail.data?.subscriptions ?? []).map((subscription) => (
                <li className="rounded border p-4" key={subscription.subscriptionInstanceId}>
                  <a
                    className="text-primary font-mono text-sm font-semibold break-all"
                    href={
                      billingSubscriptionHref(scope, subscription.subscriptionInstanceId ?? "") ??
                      "#"
                    }
                  >
                    {subscription.subscriptionInstanceId}
                  </a>
                  <div className="mt-2">
                    <SubscriptionStateAxes subscription={subscription} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WorkflowPanel>

        <WorkflowPanel
          description="Non-consumable purchases. A permanent source has no finite end Mosaic can state, which is not the same as having expired."
          title="One-time purchases"
        >
          {(detail.data?.oneTimePurchases ?? []).length === 0 ? (
            <p className="text-sm leading-6">No one-time purchase is recorded for this customer.</p>
          ) : (
            <ul className="space-y-2">
              {(detail.data?.oneTimePurchases ?? []).map((purchase) => (
                <li className="rounded border p-3" key={purchase.oneTimePurchaseInstanceId}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs break-all">
                      {purchase.oneTimePurchaseInstanceId}
                    </span>
                    <StatusPill
                      label={oneTimeValidityLabel(purchase.validityState)}
                      tone={oneTimeValidityTone(purchase.validityState)}
                    />
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {providerLabel(purchase.provider)} · acquired{" "}
                    {formatEntitlementInstant(purchase.acquiredAt)}
                  </p>
                  {purchase.mosaicProductId ? (
                    <a
                      className="text-primary mt-1 inline-flex text-xs font-semibold"
                      href={catalogProductHref(scope, purchase.mosaicProductId) ?? "#"}
                    >
                      Product
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
