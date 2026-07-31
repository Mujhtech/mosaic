import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  billingProviders,
  ENVIRONMENT_DISTINCTION_NOTE,
  providerLabel,
  resolutionStateLabel,
  resolutionStates,
  storeEnvironmentLabel,
  storeEnvironments,
} from "@/features/billing-ledger/types/billing-vocabulary"
import {
  clientAppliedFilterCount,
  hasActiveTransactionFilters,
  TRANSACTION_PAGE_SIZES,
  type TransactionFilters,
} from "@/features/billing-ledger/types/transaction-filters"
import { WorkflowPanel } from "@/features/organizations/components/workspace-page"
import type { Application, Product } from "@/generated/api"

const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 w-full rounded border px-3 text-sm outline-none focus-visible:ring-3"

interface TransactionLedgerFiltersProps {
  applications: readonly Application[]
  environmentName: string
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  products: readonly Product[]
}

export function TransactionLedgerFilters({
  applications,
  environmentName,
  filters,
  onChange,
  products,
}: TransactionLedgerFiltersProps) {
  // Any filter change invalidates the cursor: a cursor is only meaningful for
  // the query that produced it.
  function update(patch: Partial<TransactionFilters>) {
    const { cursor: _cursor, ...rest } = filters
    void _cursor
    onChange({ ...rest, ...patch })
  }

  const clientFilters = clientAppliedFilterCount(filters)

  return (
    <WorkflowPanel description={ENVIRONMENT_DISTINCTION_NOTE} title="Filters">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1 text-sm font-medium">
          Mosaic Environment
          <input
            className={`${fieldClass} text-muted-foreground`}
            disabled
            readOnly
            value={environmentName}
          />
          <span className="text-muted-foreground block text-xs font-normal">
            Fixed by the address. It is the tenant boundary, never a filter.
          </span>
        </label>

        <label className="space-y-1 text-sm font-medium">
          Store Environment
          <select
            className={fieldClass}
            onChange={(event) =>
              update({
                storeEnvironment:
                  event.currentTarget.value === ""
                    ? undefined
                    : (event.currentTarget.value as TransactionFilters["storeEnvironment"]),
              })
            }
            value={filters.storeEnvironment ?? ""}
          >
            <option value="">Any Store Environment</option>
            {storeEnvironments.map((value) => (
              <option key={value} value={value}>
                {storeEnvironmentLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm font-medium">
          Store
          <select
            className={fieldClass}
            onChange={(event) =>
              update({
                provider:
                  event.currentTarget.value === ""
                    ? undefined
                    : (event.currentTarget.value as TransactionFilters["provider"]),
              })
            }
            value={filters.provider ?? ""}
          >
            <option value="">Any store</option>
            {billingProviders.map((value) => (
              <option key={value} value={value}>
                {providerLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm font-medium">
          Application
          <select
            className={fieldClass}
            onChange={(event) => update({ applicationId: event.currentTarget.value || undefined })}
            value={filters.applicationId ?? ""}
          >
            <option value="">Any Application</option>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm font-medium">
          Mosaic Product
          <select
            className={fieldClass}
            onChange={(event) => update({ productId: event.currentTarget.value || undefined })}
            value={filters.productId ?? ""}
          >
            <option value="">Any Product</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.internalName}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm font-medium">
          Resolution
          <select
            className={fieldClass}
            onChange={(event) =>
              update({
                resolutionState:
                  event.currentTarget.value === ""
                    ? undefined
                    : (event.currentTarget.value as TransactionFilters["resolutionState"]),
              })
            }
            value={filters.resolutionState ?? ""}
          >
            <option value="">Any resolution</option>
            {resolutionStates.map((value) => (
              <option key={value} value={value}>
                {resolutionStateLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm font-medium">
          Occurred from
          <Input
            onChange={(event) => update({ from: event.currentTarget.value || undefined })}
            type="date"
            value={filters.from?.slice(0, 10) ?? ""}
          />
        </label>

        <label className="space-y-1 text-sm font-medium">
          Occurred to
          <Input
            onChange={(event) => update({ to: event.currentTarget.value || undefined })}
            type="date"
            value={filters.to?.slice(0, 10) ?? ""}
          />
        </label>

        <label className="space-y-1 text-sm font-medium">
          Transaction or Product reference
          <Input
            maxLength={128}
            onChange={(event) => update({ reference: event.currentTarget.value || undefined })}
            placeholder="Store transaction or Product identifier"
            spellCheck={false}
            value={filters.reference ?? ""}
          />
        </label>

        <label className="space-y-1 text-sm font-medium">
          Rows per page
          <select
            className={fieldClass}
            onChange={(event) => update({ limit: Number(event.currentTarget.value) })}
            value={filters.limit}
          >
            {TRANSACTION_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {hasActiveTransactionFilters(filters) ? (
          <Button
            onClick={() => onChange({ limit: filters.limit })}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear filters
          </Button>
        ) : null}
        {clientFilters > 0 ? (
          <p className="text-muted-foreground text-xs">
            {clientFilters} filter(s) are applied to the loaded page only. Store, dates, and paging
            are applied by the API; Application, Product, Store Environment, resolution, and
            reference narrow what is already on screen.
          </p>
        ) : null}
      </div>
    </WorkflowPanel>
  )
}
