import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { useCallback, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  catalogKey,
  nextProviderImportAttempt,
  type ProviderCatalogEntitlementView,
  type ProviderCatalogOfferingView,
  type ProviderCatalogPreviewView,
  type ProviderCatalogProductView,
  type ProviderImportAttempt,
  type ProviderImportResultView,
  type ProviderProductImportSelection,
  providerEntitlementSelections,
  providerImportIdentifier,
} from "@/features/provider-connections/types/provider-catalog-import";
import { providerOfferingLabel } from "@/features/provider-connections/types/provider-connection-view";
import { providerImportIdempotencyKey } from "@/features/provider-connections/types/provider-operation-input";
import type {
  Application,
  Entitlement,
  Environment,
  Product,
  ProviderConnection,
} from "@/generated/api";

interface ProductDraft {
  existingProductId: string;
  internalName: string;
  key: string;
  providerOfferingIdentifier: string;
  providerPackageIdentifier: string;
}

interface SelectOption {
  label: string;
  value: string;
}

const AVAILABILITY_OPTIONS = [
  { label: "Importable", value: "importable" },
  { label: "All provider Products", value: "all" },
];

export function ProviderCatalogImport({
  applications,
  catalogProductsHref,
  entitlements,
  environments,
  onImport,
  preview,
  products,
  provider,
  providersHref,
}: {
  applications: readonly Application[];
  catalogProductsHref: string;
  entitlements: readonly Entitlement[];
  environments: readonly Environment[];
  onImport: (
    items: ProviderProductImportSelection[],
    idempotencyKey: string
  ) => Promise<ProviderImportResultView>;
  preview: ProviderCatalogPreviewView;
  products: readonly Product[];
  provider?: ProviderConnection["provider"];
  providersHref: string;
}) {
  const fieldIds = useId();
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<"all" | "importable">(
    "importable"
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<string, ProductDraft>>({});
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(
    environments[0]?.id ?? ""
  );
  const [selectedApplicationId, setSelectedApplicationId] = useState(
    applications[0]?.id ?? ""
  );
  const [entitlementTargets, setEntitlementTargets] = useState<
    Record<string, Record<string, string>>
  >({});
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProviderImportResultView | null>(null);
  const pendingAttempt = useRef<ProviderImportAttempt | null>(null);
  const environmentOptions = environments.map((environment) => ({
    label: `${environment.name} · ${environment.mode}`,
    value: environment.id,
  }));
  const applicationOptions = applications.map((application) => ({
    label: `${application.name} · ${application.platform.toUpperCase()}`,
    value: application.id,
  }));
  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return preview.products.filter((product) => {
      if (availability === "importable" && !product.importable) {
        return false;
      }
      return (
        !needle ||
        product.storeIdentifier.toLowerCase().includes(needle) ||
        product.displayName?.toLowerCase().includes(needle)
      );
    });
  }, [availability, preview.products, search]);

  const productDraft = useCallback(
    (productId: string): ProductDraft => {
      const product = preview.products.find((item) => item.id === productId);
      return (
        drafts[productId] ?? {
          existingProductId: "",
          internalName:
            product?.displayName ||
            product?.storeIdentifier ||
            "Imported Product",
          key: catalogKey(product?.storeIdentifier ?? productId),
          providerOfferingIdentifier: "",
          providerPackageIdentifier: "",
        }
      );
    },
    [drafts, preview.products]
  );

  function updateDraft(productId: string, change: Partial<ProductDraft>) {
    setDrafts((current) => ({
      ...current,
      [productId]: { ...productDraft(productId), ...change },
    }));
  }

  function toggleProduct(productId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(productId);
      } else {
        next.delete(productId);
      }
      return next;
    });
  }

  const selections = useCallback(
    (ids: readonly string[]): ProviderProductImportSelection[] =>
      ids.flatMap((id) => {
        const product = preview.products.find((item) => item.id === id);
        if (!product) {
          return [];
        }
        const draft = productDraft(id);
        return [
          {
            applicationId: selectedApplicationId,
            entitlements: providerEntitlementSelections(
              preview.entitlements,
              entitlementTargets[id] ?? {}
            ),
            environmentId: selectedEnvironmentId,
            ...(draft.existingProductId
              ? { existingProductId: draft.existingProductId }
              : {
                  internalName: draft.internalName.trim(),
                  key: draft.key.trim(),
                }),
            ...(draft.providerOfferingIdentifier &&
            draft.providerPackageIdentifier
              ? {
                  providerOfferingIdentifier: draft.providerOfferingIdentifier,
                  providerPackageIdentifier: draft.providerPackageIdentifier,
                }
              : {}),
            providerProductIdentifier: providerImportIdentifier(product),
          },
        ];
      }),
    [
      entitlementTargets,
      preview.entitlements,
      preview.products,
      productDraft,
      selectedApplicationId,
      selectedEnvironmentId,
    ]
  );

  const submit = useCallback(
    async (ids = [...selectedIds]) => {
      setError(null);
      setIsImporting(true);
      const items = selections(ids);
      const requestSignature = JSON.stringify(items);
      const attempt = nextProviderImportAttempt(
        pendingAttempt.current,
        requestSignature,
        providerImportIdempotencyKey
      );
      pendingAttempt.current = attempt;
      try {
        const nextResult = await onImport(items, attempt.idempotencyKey);
        pendingAttempt.current = null;
        setResult(nextResult);
        if (nextResult.status === "completed") {
          setSelectedIds(new Set());
        }
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Provider import failed."
        );
      } finally {
        setIsImporting(false);
      }
    },
    [onImport, selectedIds, selections]
  );

  const handleClick = useCallback(() => {
    submit();
  }, [submit]);
  const failedProductIds =
    result?.items.flatMap((item) => {
      if (item.status === "imported") {
        return [];
      }
      const product = preview.products.find(
        (candidate) => candidate.id === item.providerProductIdentifier
      );
      return product ? [product.id] : [];
    }) ?? [];

  return (
    <div className="space-y-5">
      <CatalogSearchFilters
        availability={availability}
        fieldIds={fieldIds}
        observedAt={preview.observedAt}
        onAvailabilityChange={setAvailability}
        onSearchChange={setSearch}
        search={search}
      />

      <CatalogImportTargets
        applicationOptions={applicationOptions}
        environmentOptions={environmentOptions}
        onApplicationChange={setSelectedApplicationId}
        onEnvironmentChange={setSelectedEnvironmentId}
        selectedApplicationId={selectedApplicationId}
        selectedEnvironmentId={selectedEnvironmentId}
      />

      <ProviderCatalogProductList
        catalogProducts={visibleProducts}
        entitlementTargets={entitlementTargets}
        fieldIds={fieldIds}
        mosaicEntitlements={entitlements}
        mosaicProducts={products}
        offerings={preview.offerings}
        onEntitlementChange={(productId, entitlementId, value) =>
          setEntitlementTargets((current) => ({
            ...current,
            [productId]: {
              ...current[productId],
              [entitlementId]: value,
            },
          }))
        }
        onToggle={toggleProduct}
        onUpdateDraft={updateDraft}
        previewEntitlements={preview.entitlements}
        productDraft={productDraft}
        provider={provider}
        selectedIds={selectedIds}
      />

      {result ? (
        <ImportResult
          catalogProductsHref={catalogProductsHref}
          providersHref={providersHref}
          result={result}
        />
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <CatalogImportActions
        failedCount={failedProductIds.length}
        importDisabled={
          isImporting ||
          selectedIds.size === 0 ||
          !selectedApplicationId ||
          !selectedEnvironmentId
        }
        isImporting={isImporting}
        onImport={handleClick}
        onRetryFailed={() => {
          submit(failedProductIds);
        }}
        selectedCount={selectedIds.size}
      />
    </div>
  );
}

/**
 * Every provider Product the filters admit, each with the Mosaic target it maps
 * onto once selected.
 */
function ProviderCatalogProductList({
  catalogProducts,
  entitlementTargets,
  fieldIds,
  mosaicEntitlements,
  mosaicProducts,
  offerings,
  onEntitlementChange,
  onToggle,
  onUpdateDraft,
  previewEntitlements,
  productDraft,
  provider,
  selectedIds,
}: {
  catalogProducts: readonly ProviderCatalogProductView[];
  entitlementTargets: Record<string, Record<string, string>>;
  fieldIds: string;
  mosaicEntitlements: readonly Entitlement[];
  mosaicProducts: readonly Product[];
  offerings: readonly ProviderCatalogOfferingView[];
  onEntitlementChange: (
    productId: string,
    entitlementId: string,
    value: string
  ) => void;
  onToggle: (productId: string, checked: boolean) => void;
  onUpdateDraft: (productId: string, change: Partial<ProductDraft>) => void;
  previewEntitlements: readonly ProviderCatalogEntitlementView[];
  productDraft: (productId: string) => ProductDraft;
  provider?: ProviderConnection["provider"];
  selectedIds: ReadonlySet<string>;
}) {
  const productTargetOptions = [
    { label: "Create new Mosaic Product", value: "" },
    ...mosaicProducts.flatMap((candidate) =>
      candidate.status === "archived"
        ? []
        : [
            {
              label: `Map to ${candidate.internalName}`,
              value: candidate.id,
            },
          ]
    ),
  ];
  const entitlementTargetOptions = [
    { label: "Do not grant", value: "" },
    { label: "Create Mosaic Access definition", value: "new" },
    ...mosaicEntitlements.map((existing) => ({
      label: `Grant ${existing.name}`,
      value: existing.id,
    })),
  ];

  if (catalogProducts.length === 0) {
    return (
      <div className="rounded border border-dashed p-4">
        <p className="font-semibold text-sm">No provider Products match</p>
        <p className="mt-1 text-muted-foreground text-sm">
          Adjust search or include unavailable provider Products for diagnosis.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {catalogProducts.map((product) => (
        <ProviderProductRow
          draft={productDraft(product.id)}
          entitlementTargetOptions={entitlementTargetOptions}
          entitlementTargets={entitlementTargets[product.id]}
          key={product.id}
          offerings={offerings}
          onEntitlementChange={(entitlementId, value) =>
            onEntitlementChange(product.id, entitlementId, value)
          }
          onToggle={(checked) => onToggle(product.id, checked)}
          onUpdateDraft={(change) => onUpdateDraft(product.id, change)}
          previewEntitlements={previewEntitlements}
          product={product}
          productTargetOptions={productTargetOptions}
          provider={provider}
          rowIds={`${fieldIds}-${product.id}`}
          selected={selectedIds.has(product.id)}
        />
      ))}
    </ul>
  );
}

/**
 * Import and, when part of a batch failed, retry only the failed items — the
 * idempotency key makes the retry safe to repeat.
 */
function CatalogImportActions({
  failedCount,
  importDisabled,
  isImporting,
  onImport,
  onRetryFailed,
  selectedCount,
}: {
  failedCount: number;
  importDisabled: boolean;
  isImporting: boolean;
  onImport: () => void;
  onRetryFailed: () => void;
  selectedCount: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button disabled={importDisabled} onClick={onImport} type="button">
        {isImporting
          ? "Importing safely…"
          : `Import ${selectedCount} Product(s)`}
      </Button>
      {failedCount > 0 ? (
        <Button
          disabled={isImporting}
          onClick={onRetryFailed}
          type="button"
          variant="outline"
        >
          Retry {failedCount} failed item(s)
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Narrows the provider catalog without changing what an import would do.
 */
function CatalogSearchFilters({
  availability,
  fieldIds,
  observedAt,
  onAvailabilityChange,
  onSearchChange,
  search,
}: {
  availability: "all" | "importable";
  fieldIds: string;
  observedAt: string;
  onAvailabilityChange: (availability: "all" | "importable") => void;
  onSearchChange: (search: string) => void;
  search: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label
        className="font-medium text-sm"
        htmlFor={`${fieldIds}-search-provider-catalog`}
      >
        Search provider catalog
        <Input
          className="mt-2"
          id={`${fieldIds}-search-provider-catalog`}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          placeholder="Product name or store ID"
          value={search}
        />
      </label>
      <div className="font-medium text-sm">
        <label htmlFor="catalog-availability">Availability</label>
        <Select
          items={AVAILABILITY_OPTIONS}
          onValueChange={(value) =>
            onAvailabilityChange(value as "all" | "importable")
          }
          value={availability}
        >
          <SelectTrigger className="mt-2" id="catalog-availability">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AVAILABILITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-end text-muted-foreground text-xs">
        Observed {observedAt}
      </div>
    </div>
  );
}

/**
 * The one Environment and one Application every selected Product is imported
 * into. Mosaic never infers either from a provider identifier.
 */
function CatalogImportTargets({
  applicationOptions,
  environmentOptions,
  onApplicationChange,
  onEnvironmentChange,
  selectedApplicationId,
  selectedEnvironmentId,
}: {
  applicationOptions: readonly SelectOption[];
  environmentOptions: readonly SelectOption[];
  onApplicationChange: (applicationId: string) => void;
  onEnvironmentChange: (environmentId: string) => void;
  selectedApplicationId: string;
  selectedEnvironmentId: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="font-medium text-sm">
        <label htmlFor="catalog-environment">Mosaic Environment</label>
        <Select
          items={environmentOptions}
          onValueChange={(value) => onEnvironmentChange(value)}
          value={selectedEnvironmentId}
        >
          <SelectTrigger className="mt-2" id="catalog-environment">
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
        <label htmlFor="catalog-application">Mosaic Application</label>
        <Select
          items={applicationOptions}
          onValueChange={(value) => onApplicationChange(value)}
          value={selectedApplicationId}
        >
          <SelectTrigger className="mt-2" id="catalog-application">
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
  );
}

/**
 * One provider Product and, once selected, the Mosaic target it maps onto.
 */
function ProviderProductRow({
  draft,
  entitlementTargetOptions,
  entitlementTargets,
  offerings,
  onEntitlementChange,
  onToggle,
  onUpdateDraft,
  previewEntitlements,
  product,
  productTargetOptions,
  provider,
  rowIds,
  selected,
}: {
  draft: ProductDraft;
  entitlementTargetOptions: readonly SelectOption[];
  entitlementTargets: Record<string, string> | undefined;
  offerings: readonly ProviderCatalogOfferingView[];
  onEntitlementChange: (entitlementId: string, value: string) => void;
  onToggle: (checked: boolean) => void;
  onUpdateDraft: (change: Partial<ProductDraft>) => void;
  previewEntitlements: readonly ProviderCatalogEntitlementView[];
  product: ProviderCatalogProductView;
  productTargetOptions: readonly SelectOption[];
  provider?: ProviderConnection["provider"];
  rowIds: string;
  selected: boolean;
}) {
  const packageMappingOptions = [
    { label: "Use direct Product mapping", value: "" },
    ...offerings.flatMap((offering) =>
      offering.packages.flatMap((providerPackage) =>
        providerPackage.productIds.includes(product.id)
          ? [
              {
                label: `${offering.displayName || offering.lookupKey} · ${providerPackage.displayName || providerPackage.lookupKey}`,
                value: `${offering.id}\u0000${providerPackage.id}`,
              },
            ]
          : []
      )
    ),
  ];
  return (
    <li className="rounded border p-4">
      <div className="flex items-start gap-3">
        <input
          aria-label={`Import ${product.displayName || product.storeIdentifier}`}
          checked={selected}
          className="mt-1 size-4 accent-primary"
          disabled={!product.importable}
          onChange={(event) => onToggle(event.currentTarget.checked)}
          type="checkbox"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">
                {product.displayName || product.storeIdentifier}
              </p>
              <p className="mt-0.5 break-all font-mono text-muted-foreground text-xs">
                {product.storeIdentifier}
              </p>
            </div>
            <span className="rounded-full border bg-muted px-2.5 py-1 text-xs">
              {product.type} · {product.state}
            </span>
          </div>

          {selected ? (
            <div className="mt-4 space-y-3">
              <div className="font-medium text-xs">
                <label htmlFor={`catalog-product-target-${product.id}`}>
                  Mosaic Product target
                </label>
                <Select
                  items={productTargetOptions}
                  onValueChange={(value) =>
                    onUpdateDraft({ existingProductId: value })
                  }
                  value={draft.existingProductId}
                >
                  <SelectTrigger
                    className="mt-1"
                    id={`catalog-product-target-${product.id}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {productTargetOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {draft.existingProductId ? null : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label
                    className="font-medium text-xs"
                    htmlFor={`${rowIds}-internal-name`}
                  >
                    Internal name
                    <Input
                      className="mt-1"
                      id={`${rowIds}-internal-name`}
                      onChange={(event) =>
                        onUpdateDraft({
                          internalName: event.currentTarget.value,
                        })
                      }
                      value={draft.internalName}
                    />
                  </label>
                  <label
                    className="font-medium text-xs"
                    htmlFor={`${rowIds}-product-key`}
                  >
                    Product key
                    <Input
                      className="mt-1"
                      id={`${rowIds}-product-key`}
                      onChange={(event) =>
                        onUpdateDraft({
                          key: catalogKey(event.currentTarget.value),
                        })
                      }
                      value={draft.key}
                    />
                  </label>
                </div>
              )}

              {previewEntitlements.length > 0 ? (
                <ProviderProductAccessGrants
                  entitlements={previewEntitlements}
                  entitlementTargetOptions={entitlementTargetOptions}
                  entitlementTargets={entitlementTargets}
                  onEntitlementChange={onEntitlementChange}
                  product={product}
                />
              ) : null}

              {packageMappingOptions.length > 1 ? (
                <ProviderPackageMappingField
                  draft={draft}
                  onUpdateDraft={onUpdateDraft}
                  options={packageMappingOptions}
                  product={product}
                  provider={provider}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * The Mosaic Access each provider entitlement maps onto, configured per Product
 * rather than applied across the batch.
 */
function ProviderProductAccessGrants({
  entitlementTargetOptions,
  entitlementTargets,
  entitlements,
  onEntitlementChange,
  product,
}: {
  entitlementTargetOptions: readonly SelectOption[];
  entitlementTargets: Record<string, string> | undefined;
  entitlements: readonly ProviderCatalogEntitlementView[];
  onEntitlementChange: (entitlementId: string, value: string) => void;
  product: ProviderCatalogProductView;
}) {
  return (
    <section
      aria-label={`Access granted by ${product.displayName || product.storeIdentifier}`}
      className="rounded border p-3"
    >
      <p className="font-semibold text-xs">Access granted by this Product</p>
      <p className="mt-1 text-muted-foreground text-xs">
        Grants are configured independently for each Product. Nothing is applied
        to the rest of the import batch.
      </p>
      <div className="mt-3 grid gap-2">
        {entitlements.map((entitlement) => (
          <div className="grid gap-2 sm:grid-cols-2" key={entitlement.id}>
            <span className="text-xs">
              <span className="block font-medium">
                {entitlement.displayName || entitlement.lookupKey}
              </span>
              <span className="text-muted-foreground">
                {entitlement.lookupKey}
              </span>
            </span>
            <Select
              items={entitlementTargetOptions}
              onValueChange={(value) =>
                onEntitlementChange(entitlement.id, value)
              }
              value={entitlementTargets?.[entitlement.id] ?? ""}
            >
              <SelectTrigger
                aria-label={`Mosaic Access for ${entitlement.displayName || entitlement.lookupKey} on ${product.displayName || product.storeIdentifier}`}
                className="w-auto min-w-48"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entitlementTargetOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Exact provider grouping, hidden by default because it is an adapter detail
 * rather than Mosaic Catalog hierarchy.
 */
function ProviderPackageMappingField({
  draft,
  onUpdateDraft,
  options,
  product,
  provider,
}: {
  draft: ProductDraft;
  onUpdateDraft: (change: Partial<ProductDraft>) => void;
  options: readonly SelectOption[];
  product: ProviderCatalogProductView;
  provider?: ProviderConnection["provider"];
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-1 rounded font-medium text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Advanced {providerOfferingLabel(provider)}
        <CaretDownIcon aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <div className="font-medium text-xs">
          <label htmlFor={`catalog-package-${product.id}`}>
            Exact {providerOfferingLabel(provider)} mapping
          </label>
          <Select
            items={options}
            onValueChange={(value) => {
              const [offeringId = "", packageId = ""] = value.split("\u0000");
              onUpdateDraft({
                providerOfferingIdentifier: offeringId,
                providerPackageIdentifier: packageId,
              });
            }}
            value={
              draft.providerOfferingIdentifier
                ? `${draft.providerOfferingIdentifier}\u0000${draft.providerPackageIdentifier}`
                : ""
            }
          >
            <SelectTrigger
              className="mt-1"
              id={`catalog-package-${product.id}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="mt-2 text-muted-foreground text-xs">
          Hidden by default because provider grouping is an adapter detail, not
          Mosaic Catalog hierarchy.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ImportResult({
  catalogProductsHref,
  providersHref,
  result,
}: {
  catalogProductsHref: string;
  providersHref: string;
  result: ProviderImportResultView;
}) {
  const failureCount = result.items.filter(
    (item) => item.status !== "imported"
  ).length;
  return (
    <section
      aria-labelledby="provider-import-result-title"
      className={
        failureCount > 0
          ? "rounded border border-destructive/25 bg-destructive/5 p-4"
          : "rounded border border-primary/25 bg-primary/5 p-4"
      }
      role="status"
    >
      <h3
        className="flex items-center gap-2 font-semibold text-sm"
        id="provider-import-result-title"
      >
        {failureCount > 0 ? (
          <WarningCircleIcon aria-hidden className="text-destructive" />
        ) : (
          <CheckCircleIcon aria-hidden className="text-primary" weight="fill" />
        )}
        Import {result.status.replaceAll("_", " ")}
      </h3>
      <p className="mt-1 text-muted-foreground text-xs">
        {result.items.length - failureCount} imported · {failureCount} failed ·
        request {result.id}
      </p>
      {failureCount > 0 ? (
        <ul className="mt-3 space-y-1 text-xs">
          {result.items.flatMap((item) =>
            item.status === "imported"
              ? []
              : [
                  <li key={item.providerProductIdentifier}>
                    {item.providerProductIdentifier} ·{" "}
                    {item.errorCode ?? item.status}
                  </li>,
                ]
          )}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3 font-semibold text-xs">
        <a className="text-primary" href={catalogProductsHref}>
          Review imported Products and assign Plans
        </a>
        <a className="text-primary" href={providersHref}>
          Select the active provider
        </a>
      </div>
    </section>
  );
}
