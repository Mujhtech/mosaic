import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  billingProviders,
  ENVIRONMENT_DISTINCTION_NOTE,
  providerLabel,
  resolutionStateLabel,
  resolutionStates,
  storeEnvironmentLabel,
  storeEnvironments,
} from "@/features/billing-ledger/types/billing-vocabulary";
import {
  clientAppliedFilterCount,
  hasActiveTransactionFilters,
  TRANSACTION_PAGE_SIZES,
  type TransactionFilters,
} from "@/features/billing-ledger/types/transaction-filters";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import type { Application, Product } from "@/generated/api";

const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 w-full rounded border px-3 text-sm outline-none focus-visible:ring-3";

interface TransactionLedgerFiltersProps {
  applications: readonly Application[];
  environmentName: string;
  filters: TransactionFilters;
  onChange: (filters: TransactionFilters) => void;
  products: readonly Product[];
}

export function TransactionLedgerFilters({
  applications,
  environmentName,
  filters,
  onChange,
  products,
}: TransactionLedgerFiltersProps) {
  const fieldIds = useId();
  // Any filter change invalidates the cursor: a cursor is only meaningful for
  // the query that produced it.
  function update(patch: Partial<TransactionFilters>) {
    const { cursor: _cursor, ...rest } = filters;
    onChange({ ...rest, ...patch });
  }

  const storeEnvironmentOptions = [
    { label: "Any Store Environment", value: "" },
    ...storeEnvironments.map((value) => ({
      label: storeEnvironmentLabel(value),
      value,
    })),
  ];
  const providerOptions = [
    { label: "Any store", value: "" },
    ...billingProviders.map((value) => ({
      label: providerLabel(value),
      value,
    })),
  ];
  const applicationOptions = [
    { label: "Any Application", value: "" },
    ...applications.map((application) => ({
      label: application.name,
      value: application.id,
    })),
  ];
  const productOptions = [
    { label: "Any Product", value: "" },
    ...products.map((product) => ({
      label: product.internalName,
      value: product.id,
    })),
  ];
  const resolutionOptions = [
    { label: "Any resolution", value: "" },
    ...resolutionStates.map((value) => ({
      label: resolutionStateLabel(value),
      value,
    })),
  ];
  const pageSizeOptions = TRANSACTION_PAGE_SIZES.map((size) => ({
    label: String(size),
    value: String(size),
  }));

  const clientFilters = clientAppliedFilterCount(filters);

  return (
    <WorkflowPanel description={ENVIRONMENT_DISTINCTION_NOTE} title="Filters">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1 font-medium text-sm">
          Mosaic Environment
          <input
            className={`${fieldClass} text-muted-foreground`}
            disabled
            readOnly
            value={environmentName}
          />
          <span className="block font-normal text-muted-foreground text-xs">
            Fixed by the address. It is the tenant boundary, never a filter.
          </span>
        </label>

        <div className="space-y-1 font-medium text-sm">
          <label htmlFor="ledger-store-environment">Store Environment</label>
          <Select
            items={storeEnvironmentOptions}
            onValueChange={(value) =>
              update({
                storeEnvironment: (value ||
                  undefined) as TransactionFilters["storeEnvironment"],
              })
            }
            value={filters.storeEnvironment ?? ""}
          >
            <SelectTrigger id="ledger-store-environment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {storeEnvironmentOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 font-medium text-sm">
          <label htmlFor="ledger-store">Store</label>
          <Select
            items={providerOptions}
            onValueChange={(value) =>
              update({
                provider: (value ||
                  undefined) as TransactionFilters["provider"],
              })
            }
            value={filters.provider ?? ""}
          >
            <SelectTrigger id="ledger-store">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providerOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 font-medium text-sm">
          <label htmlFor="ledger-application">Application</label>
          <Select
            items={applicationOptions}
            onValueChange={(value) =>
              update({ applicationId: value || undefined })
            }
            value={filters.applicationId ?? ""}
          >
            <SelectTrigger id="ledger-application">
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

        <div className="space-y-1 font-medium text-sm">
          <label htmlFor="ledger-product">Mosaic Product</label>
          <Select
            items={productOptions}
            onValueChange={(value) => update({ productId: value || undefined })}
            value={filters.productId ?? ""}
          >
            <SelectTrigger id="ledger-product">
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

        <div className="space-y-1 font-medium text-sm">
          <label htmlFor="ledger-resolution">Resolution</label>
          <Select
            items={resolutionOptions}
            onValueChange={(value) =>
              update({
                resolutionState: (value ||
                  undefined) as TransactionFilters["resolutionState"],
              })
            }
            value={filters.resolutionState ?? ""}
          >
            <SelectTrigger id="ledger-resolution">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {resolutionOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label
          className="space-y-1 font-medium text-sm"
          htmlFor={`${fieldIds}-occurred-from`}
        >
          Occurred from
          <Input
            id={`${fieldIds}-occurred-from`}
            onChange={(event) =>
              update({ from: event.currentTarget.value || undefined })
            }
            type="date"
            value={filters.from?.slice(0, 10) ?? ""}
          />
        </label>

        <label
          className="space-y-1 font-medium text-sm"
          htmlFor={`${fieldIds}-occurred-to`}
        >
          Occurred to
          <Input
            id={`${fieldIds}-occurred-to`}
            onChange={(event) =>
              update({ to: event.currentTarget.value || undefined })
            }
            type="date"
            value={filters.to?.slice(0, 10) ?? ""}
          />
        </label>

        <label
          className="space-y-1 font-medium text-sm"
          htmlFor={`${fieldIds}-transaction-or-product-reference`}
        >
          Transaction or Product reference
          <Input
            id={`${fieldIds}-transaction-or-product-reference`}
            maxLength={128}
            onChange={(event) =>
              update({ reference: event.currentTarget.value || undefined })
            }
            placeholder="Store transaction or Product identifier"
            spellCheck={false}
            value={filters.reference ?? ""}
          />
        </label>

        <div className="space-y-1 font-medium text-sm">
          <label htmlFor="ledger-page-size">Rows per page</label>
          <Select
            items={pageSizeOptions}
            onValueChange={(value) => update({ limit: Number(value) })}
            value={String(filters.limit)}
          >
            <SelectTrigger id="ledger-page-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
            {clientFilters} filter(s) are applied to the loaded page only.
            Store, dates, and paging are applied by the API; Application,
            Product, Store Environment, resolution, and reference narrow what is
            already on screen.
          </p>
        ) : null}
      </div>
    </WorkflowPanel>
  );
}
