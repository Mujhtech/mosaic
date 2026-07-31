import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { EmptyState } from "@/components/feedback/empty-state"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { BillingBoundaryNote } from "@/features/billing-ledger/components/billing-chrome"
import { TransactionLedgerFilters } from "@/features/billing-ledger/components/transaction-ledger-filters"
import { TransactionLedgerTable } from "@/features/billing-ledger/components/transaction-ledger-table"
import { transactionFactsQueryOptions } from "@/features/billing-ledger/queries/transaction-queries"
import { BILLING_OPTIONAL_NOTE } from "@/features/billing-ledger/types/billing-vocabulary"
import {
  applyClientTransactionFilters,
  hasActiveTransactionFilters,
  type TransactionFilters,
} from "@/features/billing-ledger/types/transaction-filters"
import { billingHealthQueryOptions } from "@/features/billing-operations/queries/billing-health-queries"
import { productsQueryOptions } from "@/features/catalog/queries/catalog-query"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query"
import { storeConnectionsHref } from "@/lib/routing/workspace-hrefs"

interface TransactionLedgerPageProps {
  environmentId: string
  filters: TransactionFilters
  onFiltersChange: (filters: TransactionFilters) => void
  organizationId: string
  projectId: string
}

export function TransactionLedgerPage({
  environmentId,
  filters,
  onFiltersChange,
  organizationId,
  projectId,
}: TransactionLedgerPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const applications = useQuery({ ...applicationsQueryOptions(projectId), enabled: scopeReady })
  const products = useQuery({ ...productsQueryOptions(projectId), enabled: scopeReady })
  const health = useQuery({
    ...billingHealthQueryOptions(projectId, environmentId),
    enabled: scopeReady,
  })
  const facts = useQuery({
    ...transactionFactsQueryOptions(projectId, environmentId, filters),
    enabled: scopeReady,
  })

  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ?? environmentId
  const loaded = facts.data?.items ?? []
  const visible = applyClientTransactionFilters(loaded, filters)
  const billingEnabled = health.data?.billingEnabled !== false

  const error = project.error ?? environments.error ?? applications.error ?? facts.error
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending:
      project.isPending ||
      (scopeReady && (environments.isPending || applications.isPending || facts.isPending)),
    loadingDescription: `Loading Transaction Facts for the ${environmentName} Mosaic Environment.`,
    onRetry: () => {
      void facts.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to read the Mosaic Billing ledger.",
    scope: { environmentId, organizationId, projectId },
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Transaction ledger unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  const connectionsHref = storeConnectionsHref({ organizationId, projectId }) ?? "#"
  const base = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/billing/${encodeURIComponent(environmentId)}`

  return (
    <WorkspacePage
      description="Every validated store transaction Mosaic recorded in this Mosaic Environment, newest first. The ledger is append-only: nothing on this page can change a recorded fact."
      eyebrow="Mosaic Billing · Transaction ledger"
      title="Transaction ledger"
    >
      <BillingBoundaryNote />

      <TransactionLedgerFilters
        applications={applications.data?.items ?? []}
        environmentName={environmentName}
        filters={filters}
        onChange={onFiltersChange}
        products={products.data?.items ?? []}
      />

      <HostedResourceBoundary state={state}>
        {!billingEnabled ? (
          <EmptyState
            action={
              <a className={buttonVariants()} href={connectionsHref}>
                Set up Mosaic Billing
              </a>
            }
            description={`Mosaic Billing is turned off for this Project, so no store input is accepted or recorded. ${BILLING_OPTIONAL_NOTE}`}
            title="Mosaic Billing is not enabled for this Project"
          />
        ) : loaded.length === 0 && !hasActiveTransactionFilters(filters) ? (
          <>
            <EmptyState
              action={
                <a className={buttonVariants({ variant: "outline" })} href={`${base}/health`}>
                  Check intake health
                </a>
              }
              description="No Store Notification or Transaction Observation has produced a validated fact in this Mosaic Environment yet. Confirm the store-side notification setup, then watch billing health for the first accepted input."
              title="No Transaction Facts recorded yet"
            />
            <LedgerPaging
              cursor={filters.cursor}
              nextCursor={facts.data?.nextCursor}
              onCursorChange={(cursor) => onFiltersChange({ ...filters, cursor })}
            />
          </>
        ) : visible.length === 0 ? (
          <>
            <EmptyState
              action={
                <Button onClick={() => onFiltersChange({ limit: filters.limit })} type="button">
                  Clear filters
                </Button>
              }
              description="Facts exist in this Mosaic Environment, but none on the loaded page matches the current filters. Application, Product, Store Environment, resolution, and reference narrow the loaded page only — matches further back in the ledger are on later pages."
              title="No Transaction Facts match these filters"
            />
            {/* Paging has to survive the filtered-empty branch. Without it, an
                operator filtering for an Application whose facts start on page
                three has no way forward and discarding the filter is the only
                exit. */}
            <LedgerPaging
              cursor={filters.cursor}
              nextCursor={facts.data?.nextCursor}
              onCursorChange={(cursor) => onFiltersChange({ ...filters, cursor })}
            />
          </>
        ) : (
          <WorkflowPanel
            description="Occurred at is the store's own clock. Recorded at is when Mosaic durably accepted the input. They are never the same."
            title={`${visible.length} Transaction Fact(s) on this page`}
          >
            <TransactionLedgerTable
              applications={applications.data?.items ?? []}
              environmentName={environmentName}
              factHref={(factId) => `${base}/transactions/${encodeURIComponent(factId)}`}
              isPending={facts.isPending}
              items={visible}
              products={products.data?.items ?? []}
            />
            <LedgerPaging
              cursor={filters.cursor}
              nextCursor={facts.data?.nextCursor}
              onCursorChange={(cursor) => onFiltersChange({ ...filters, cursor })}
            />
          </WorkflowPanel>
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}

/**
 * Forward paging over the ledger.
 *
 * Rendered beside every branch, including the filtered-empty one: several
 * filters are applied to the loaded page only, so "nothing matched here" must
 * still offer a way to look at the next page.
 */
function LedgerPaging({
  cursor,
  nextCursor,
  onCursorChange,
}: {
  cursor: string | undefined
  nextCursor: string | undefined
  onCursorChange: (cursor: string | undefined) => void
}) {
  if (!cursor && !nextCursor) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {cursor ? (
        <Button onClick={() => onCursorChange(undefined)} size="sm" type="button" variant="outline">
          First page
        </Button>
      ) : null}
      {nextCursor ? (
        <Button
          onClick={() => onCursorChange(nextCursor)}
          size="sm"
          type="button"
          variant="outline"
        >
          Next page
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">End of the ledger for these filters.</p>
      )}
    </div>
  )
}
