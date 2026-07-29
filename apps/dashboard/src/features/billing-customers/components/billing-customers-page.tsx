import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { LedgerPaging, StatusPill } from "@/features/billing-ledger/components/billing-chrome"
import { BILLING_OPTIONAL_NOTE } from "@/features/billing-ledger/types/billing-vocabulary"
import { billingHealthQueryOptions } from "@/features/billing-operations/queries/billing-health-queries"
import { CustomerSearchForm } from "@/features/billing-customers/components/customer-search-form"
import { lookupBillingCustomerMutationOptions } from "@/features/billing-customers/mutations/customer-mutations"
import { billingCustomersQueryOptions } from "@/features/billing-customers/queries/customer-queries"
import {
  describeLookupMiss,
  type CustomerIdentifierType,
} from "@/features/billing-customers/types/customer-search"
import {
  AUTHORITATIVE_ACCESS_NOTE,
  customerIdentityExplanation,
  customerIdentityLabel,
  customerStatusLabel,
  customerStatusTone,
  formatEntitlementInstant,
} from "@/features/billing-customers/types/entitlement-vocabulary"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { WorkflowPanel, WorkspacePage } from "@/features/organizations/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { billingCustomerHref, storeConnectionsHref } from "@/lib/routing/workspace-hrefs"
import type { BillingCustomerSummary } from "@/generated/api"

interface BillingCustomersPageProps {
  conflictedOnly?: boolean
  cursor?: string
  environmentId: string
  onFiltersChange: (filters: { conflictedOnly?: boolean; cursor?: string }) => void
  organizationId: string
  projectId: string
}

/**
 * Billing Customers in one Mosaic Environment.
 *
 * The list exists to be browsed by an operator who already has an identifier,
 * not to be searched by attributes of a person: Mosaic Billing stores aliases
 * as digests, so there is nothing to search by and the lookup above is typed.
 */
export function BillingCustomersPage({
  conflictedOnly,
  cursor,
  environmentId,
  onFiltersChange,
  organizationId,
  projectId,
}: BillingCustomersPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const health = useQuery({
    ...billingHealthQueryOptions(projectId, environmentId),
    enabled: scopeReady,
  })
  const customers = useQuery({
    ...billingCustomersQueryOptions(projectId, environmentId, {
      ...(conflictedOnly ? { conflictedOnly: true } : {}),
      ...(cursor ? { cursor } : {}),
    }),
    enabled: scopeReady,
  })
  const lookup = useMutation(lookupBillingCustomerMutationOptions(projectId, environmentId))
  const [missMessage, setMissMessage] = useState<string | undefined>(undefined)

  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ?? environmentId
  const billingEnabled = health.data?.billingEnabled !== false
  const items = customers.data?.items ?? []

  const error = project.error ?? environments.error ?? customers.error
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending: project.isPending || (scopeReady && (environments.isPending || customers.isPending)),
    loadingDescription: `Loading Billing Customers for the ${environmentName} Mosaic Environment.`,
    onRetry: () => {
      void customers.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to read Billing Customers.",
    scope: { environmentId, organizationId, projectId },
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Billing Customers unavailable in this Organization"
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
  const connectionsHref = storeConnectionsHref(scope) ?? "#"

  async function search(input: {
    identifierType: CustomerIdentifierType
    identifierValue: string
  }) {
    setMissMessage(undefined)
    const result = await lookup.mutateAsync(input)
    if (result?.found && result.customer?.billingCustomerId) {
      window.location.assign(billingCustomerHref(scope, result.customer.billingCustomerId) ?? "#")
      return
    }
    // A miss is an answer. It renders as a result, never as a failure banner.
    setMissMessage(describeLookupMiss(input.identifierType))
  }

  return (
    <WorkspacePage
      description="The people and purchase anchors Mosaic holds authoritative access state for in this Mosaic Environment. A customer's identity belongs to the Project; everything Mosaic computes about their access belongs to this Environment."
      eyebrow="Mosaic Billing · Customers"
      title="Customers"
    >
      <p className="text-muted-foreground text-xs leading-5">{AUTHORITATIVE_ACCESS_NOTE}</p>

      <WorkflowPanel title="Find a customer">
        <CustomerSearchForm isPending={lookup.isPending} onSearch={search} />
        {missMessage ? (
          <div className="mt-4">
            <EmptyState description={missMessage} title="No matching Billing Customer" />
          </div>
        ) : null}
        {lookup.error ? (
          <p className="text-destructive mt-3 text-sm" role="alert">
            {lookup.error.message}
          </p>
        ) : null}
      </WorkflowPanel>

      <HostedResourceBoundary state={state}>
        {!billingEnabled ? (
          <EmptyState
            action={
              <a className={buttonVariants()} href={connectionsHref}>
                Set up Mosaic Billing
              </a>
            }
            description={`Mosaic Billing is turned off for this Project, so no purchase is recorded and no access is computed. Every Entitlement read answers "Mosaic cannot answer" rather than inactive. ${BILLING_OPTIONAL_NOTE}`}
            title="Mosaic Billing is not enabled for this Project"
          />
        ) : items.length === 0 ? (
          <>
            <EmptyState
              description={
                conflictedOnly
                  ? "No Billing Customer in this Mosaic Environment is party to an open identity conflict. That is the healthy state."
                  : "No Billing Customer exists in this Mosaic Environment yet. One comes into existence when your backend identifies a user, or when a validated purchase needs somewhere to attach — never when an SDK merely starts up."
              }
              title={
                conflictedOnly ? "No conflicted customers" : "No Billing Customers recorded yet"
              }
            />
            <LedgerPaging
              cursor={cursor}
              endLabel="End of the customer list."
              nextCursor={customers.data?.nextCursor}
              onCursorChange={(next) =>
                onFiltersChange({ ...(conflictedOnly ? { conflictedOnly } : {}), cursor: next })
              }
            />
          </>
        ) : (
          <WorkflowPanel
            description="Identified means a person your backend named is attached. Purchase-anchored means revenue is attached but nobody has been named yet — the correct resting state for an anonymous purchase, not a defect."
            title={`${items.length} Billing Customer(s) on this page`}
          >
            <label className="mb-4 flex items-center gap-2 text-sm">
              <input
                checked={conflictedOnly === true}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  onFiltersChange(checked ? { conflictedOnly: true } : {})
                }}
                type="checkbox"
              />
              Show only customers party to an open identity conflict
            </label>

            <ul className="space-y-2">
              {items.map((customer) => (
                <CustomerRow
                  customer={customer}
                  href={billingCustomerHref(scope, customer.billingCustomerId ?? "") ?? "#"}
                  key={customer.billingCustomerId}
                />
              ))}
            </ul>

            <LedgerPaging
              cursor={cursor}
              endLabel="End of the customer list."
              nextCursor={customers.data?.nextCursor}
              onCursorChange={(next) =>
                onFiltersChange({ ...(conflictedOnly ? { conflictedOnly } : {}), cursor: next })
              }
            />
          </WorkflowPanel>
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}

function CustomerRow({ customer, href }: { customer: BillingCustomerSummary; href: string }) {
  return (
    <li className="rounded border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a className="text-primary font-mono text-sm font-semibold break-all" href={href}>
          {customer.billingCustomerId}
        </a>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            label={customerStatusLabel(customer.status)}
            tone={customerStatusTone(customer.status)}
          />
          <StatusPill label={customerIdentityLabel(customer)} tone="neutral" />
          {/* The attention pill an operator scans for. A conflicted customer is
              frozen, so anything else on the row is the last committed state
              rather than the current one. */}
          {customer.hasOpenIdentityConflict ? (
            <StatusPill label="Open identity conflict" tone="attention" />
          ) : null}
        </div>
      </div>
      <p className="text-muted-foreground mt-2 text-xs leading-5">
        {customerIdentityExplanation(customer)}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        {customer.snapshotVersion === undefined
          ? "Never projected in this Environment — not the same as having no entitlements."
          : `Snapshot version ${customer.snapshotVersion}`}{" "}
        · last projected {formatEntitlementInstant(customer.lastProjectedAt)}
      </p>
    </li>
  )
}
