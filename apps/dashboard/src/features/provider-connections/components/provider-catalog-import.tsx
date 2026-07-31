import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"
import { useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import {
  catalogKey,
  nextProviderImportAttempt,
  providerEntitlementSelections,
  providerImportIdentifier,
  type ProviderImportAttempt,
  type ProviderCatalogPreviewView,
  type ProviderImportResultView,
  type ProviderProductImportSelection,
} from "@/features/provider-connections/types/provider-catalog-import"
import { providerImportIdempotencyKey } from "@/features/provider-connections/types/provider-operation-input"
import type { Application, Entitlement, Environment, Product } from "@/generated/api"

interface ProductDraft {
  existingProductId: string
  internalName: string
  key: string
  providerOfferingIdentifier: string
  providerPackageIdentifier: string
}

export function ProviderCatalogImport({
  applications,
  catalogProductsHref,
  entitlements,
  environments,
  onImport,
  preview,
  products,
  providersHref,
}: {
  applications: readonly Application[]
  catalogProductsHref: string
  entitlements: readonly Entitlement[]
  environments: readonly Environment[]
  onImport: (
    items: ProviderProductImportSelection[],
    idempotencyKey: string,
  ) => Promise<ProviderImportResultView>
  preview: ProviderCatalogPreviewView
  products: readonly Product[]
  providersHref: string
}) {
  const [search, setSearch] = useState("")
  const [availability, setAvailability] = useState<"all" | "importable">("importable")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [drafts, setDrafts] = useState<Record<string, ProductDraft>>({})
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState(environments[0]?.id ?? "")
  const [selectedApplicationId, setSelectedApplicationId] = useState(applications[0]?.id ?? "")
  const [entitlementTargets, setEntitlementTargets] = useState<
    Record<string, Record<string, string>>
  >({})
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ProviderImportResultView | null>(null)
  const pendingAttempt = useRef<ProviderImportAttempt | null>(null)
  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return preview.products.filter((product) => {
      if (availability === "importable" && !product.importable) return false
      return (
        !needle ||
        product.storeIdentifier.toLowerCase().includes(needle) ||
        product.displayName?.toLowerCase().includes(needle)
      )
    })
  }, [availability, preview.products, search])

  function productDraft(productId: string): ProductDraft {
    const product = preview.products.find((item) => item.id === productId)
    return (
      drafts[productId] ?? {
        existingProductId: "",
        internalName: product?.displayName || product?.storeIdentifier || "Imported Product",
        key: catalogKey(product?.storeIdentifier ?? productId),
        providerOfferingIdentifier: "",
        providerPackageIdentifier: "",
      }
    )
  }

  function updateDraft(productId: string, change: Partial<ProductDraft>) {
    setDrafts((current) => ({
      ...current,
      [productId]: { ...productDraft(productId), ...change },
    }))
  }

  function toggleProduct(productId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(productId)
      else next.delete(productId)
      return next
    })
  }

  function selections(ids: readonly string[]): ProviderProductImportSelection[] {
    return ids.flatMap((id) => {
      const product = preview.products.find((item) => item.id === id)
      if (!product) return []
      const draft = productDraft(id)
      return [
        {
          applicationId: selectedApplicationId,
          entitlements: providerEntitlementSelections(
            preview.entitlements,
            entitlementTargets[id] ?? {},
          ),
          environmentId: selectedEnvironmentId,
          ...(draft.existingProductId
            ? { existingProductId: draft.existingProductId }
            : { internalName: draft.internalName.trim(), key: draft.key.trim() }),
          ...(draft.providerOfferingIdentifier && draft.providerPackageIdentifier
            ? {
                providerOfferingIdentifier: draft.providerOfferingIdentifier,
                providerPackageIdentifier: draft.providerPackageIdentifier,
              }
            : {}),
          providerProductIdentifier: providerImportIdentifier(product),
        },
      ]
    })
  }

  async function submit(ids = [...selectedIds]) {
    setError(null)
    setIsImporting(true)
    const items = selections(ids)
    const requestSignature = JSON.stringify(items)
    const attempt = nextProviderImportAttempt(
      pendingAttempt.current,
      requestSignature,
      providerImportIdempotencyKey,
    )
    pendingAttempt.current = attempt
    try {
      const nextResult = await onImport(items, attempt.idempotencyKey)
      pendingAttempt.current = null
      setResult(nextResult)
      if (nextResult.status === "completed") setSelectedIds(new Set())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Provider import failed.")
    } finally {
      setIsImporting(false)
    }
  }

  const failedProductIds =
    result?.items
      .filter((item) => item.status !== "imported")
      .flatMap((item) => {
        const product = preview.products.find(
          (candidate) => candidate.id === item.providerProductIdentifier,
        )
        return product ? [product.id] : []
      }) ?? []

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-medium">
          Search provider catalog
          <Input
            className="mt-2"
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Product name or store ID"
            value={search}
          />
        </label>
        <label className="text-sm font-medium">
          Availability
          <select
            className="border-input bg-background mt-2 h-9 w-full rounded border px-3"
            onChange={(event) => setAvailability(event.currentTarget.value as "all" | "importable")}
            value={availability}
          >
            <option value="importable">Importable</option>
            <option value="all">All provider Products</option>
          </select>
        </label>
        <div className="text-muted-foreground flex items-end text-xs">
          Observed {preview.observedAt}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Mosaic Environment
          <select
            className="border-input bg-background mt-2 h-9 w-full rounded border px-3"
            onChange={(event) => setSelectedEnvironmentId(event.currentTarget.value)}
            value={selectedEnvironmentId}
          >
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name} · {environment.mode}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Mosaic Application
          <select
            className="border-input bg-background mt-2 h-9 w-full rounded border px-3"
            onChange={(event) => setSelectedApplicationId(event.currentTarget.value)}
            value={selectedApplicationId}
          >
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.name} · {application.platform.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visibleProducts.length === 0 ? (
        <div className="rounded border border-dashed p-4">
          <p className="text-sm font-semibold">No provider Products match</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Adjust search or include unavailable provider Products for diagnosis.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleProducts.map((product) => {
            const draft = productDraft(product.id)
            const selected = selectedIds.has(product.id)
            const packageOptions = preview.offerings.flatMap((offering) =>
              offering.packages
                .filter((providerPackage) => providerPackage.productIds.includes(product.id))
                .map((providerPackage) => ({ offering, providerPackage })),
            )
            return (
              <li className="rounded border p-4" key={product.id}>
                <div className="flex items-start gap-3">
                  <input
                    aria-label={`Import ${product.displayName || product.storeIdentifier}`}
                    checked={selected}
                    className="accent-primary mt-1 size-4"
                    disabled={!product.importable}
                    onChange={(event) => toggleProduct(product.id, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {product.displayName || product.storeIdentifier}
                        </p>
                        <p className="text-muted-foreground mt-0.5 font-mono text-xs break-all">
                          {product.storeIdentifier}
                        </p>
                      </div>
                      <span className="bg-muted rounded-full border px-2.5 py-1 text-xs">
                        {product.type} · {product.state}
                      </span>
                    </div>

                    {selected ? (
                      <div className="mt-4 space-y-3">
                        <label className="text-xs font-medium">
                          Mosaic Product target
                          <select
                            className="border-input bg-background mt-1 h-9 w-full rounded border px-3 text-sm"
                            onChange={(event) =>
                              updateDraft(product.id, {
                                existingProductId: event.currentTarget.value,
                              })
                            }
                            value={draft.existingProductId}
                          >
                            <option value="">Create new Mosaic Product</option>
                            {products
                              .filter((candidate) => candidate.status !== "archived")
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  Map to {candidate.internalName}
                                </option>
                              ))}
                          </select>
                        </label>
                        {!draft.existingProductId ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs font-medium">
                              Internal name
                              <Input
                                className="mt-1"
                                onChange={(event) =>
                                  updateDraft(product.id, {
                                    internalName: event.currentTarget.value,
                                  })
                                }
                                value={draft.internalName}
                              />
                            </label>
                            <label className="text-xs font-medium">
                              Product key
                              <Input
                                className="mt-1"
                                onChange={(event) =>
                                  updateDraft(product.id, {
                                    key: catalogKey(event.currentTarget.value),
                                  })
                                }
                                value={draft.key}
                              />
                            </label>
                          </div>
                        ) : null}

                        {preview.entitlements.length > 0 ? (
                          <section
                            aria-label={`Access granted by ${product.displayName || product.storeIdentifier}`}
                            className="rounded border p-3"
                          >
                            <p className="text-xs font-semibold">Access granted by this Product</p>
                            <p className="text-muted-foreground mt-1 text-xs">
                              Grants are configured independently for each Product. Nothing is
                              applied to the rest of the import batch.
                            </p>
                            <div className="mt-3 grid gap-2">
                              {preview.entitlements.map((entitlement) => (
                                <label className="grid gap-2 sm:grid-cols-2" key={entitlement.id}>
                                  <span className="text-xs">
                                    <span className="block font-medium">
                                      {entitlement.displayName || entitlement.lookupKey}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {entitlement.lookupKey}
                                    </span>
                                  </span>
                                  <select
                                    aria-label={`Mosaic Access for ${entitlement.displayName || entitlement.lookupKey} on ${product.displayName || product.storeIdentifier}`}
                                    className="border-input bg-background h-9 rounded border px-3 text-sm"
                                    onChange={(event) =>
                                      setEntitlementTargets((current) => ({
                                        ...current,
                                        [product.id]: {
                                          ...current[product.id],
                                          [entitlement.id]: event.currentTarget.value,
                                        },
                                      }))
                                    }
                                    value={entitlementTargets[product.id]?.[entitlement.id] ?? ""}
                                  >
                                    <option value="">Do not grant</option>
                                    <option value="new">Create Mosaic Access definition</option>
                                    {entitlements.map((existing) => (
                                      <option key={existing.id} value={existing.id}>
                                        Grant {existing.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ))}
                            </div>
                          </section>
                        ) : null}

                        {packageOptions.length > 0 ? (
                          <Collapsible>
                            <CollapsibleTrigger className="focus-visible:ring-ring flex items-center gap-1 rounded text-xs font-medium focus-visible:ring-2 focus-visible:outline-none">
                              Advanced RevenueCat Package and Offering
                              <CaretDownIcon aria-hidden />
                            </CollapsibleTrigger>
                            <CollapsibleContent className="mt-2">
                              <label className="text-xs font-medium">
                                Exact Package mapping
                                <select
                                  className="border-input bg-background mt-1 h-9 w-full rounded border px-3 text-sm"
                                  onChange={(event) => {
                                    const [offeringId = "", packageId = ""] =
                                      event.currentTarget.value.split("\u0000")
                                    updateDraft(product.id, {
                                      providerOfferingIdentifier: offeringId,
                                      providerPackageIdentifier: packageId,
                                    })
                                  }}
                                  value={
                                    draft.providerOfferingIdentifier
                                      ? `${draft.providerOfferingIdentifier}\u0000${draft.providerPackageIdentifier}`
                                      : ""
                                  }
                                >
                                  <option value="">Use direct Product mapping</option>
                                  {packageOptions.map(({ offering, providerPackage }) => (
                                    <option
                                      key={`${offering.id}:${providerPackage.id}`}
                                      value={`${offering.id}\u0000${providerPackage.id}`}
                                    >
                                      {offering.displayName || offering.lookupKey} ·{" "}
                                      {providerPackage.displayName || providerPackage.lookupKey}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <p className="text-muted-foreground mt-2 text-xs">
                                Hidden by default because Packages and Offerings are adapter
                                details, not Mosaic Catalog hierarchy.
                              </p>
                            </CollapsibleContent>
                          </Collapsible>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

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
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            isImporting ||
            selectedIds.size === 0 ||
            !selectedApplicationId ||
            !selectedEnvironmentId
          }
          onClick={() => void submit()}
          type="button"
        >
          {isImporting ? "Importing safely…" : `Import ${selectedIds.size} Product(s)`}
        </Button>
        {failedProductIds.length > 0 ? (
          <Button
            disabled={isImporting}
            onClick={() => void submit(failedProductIds)}
            type="button"
            variant="outline"
          >
            Retry {failedProductIds.length} failed item(s)
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ImportResult({
  catalogProductsHref,
  providersHref,
  result,
}: {
  catalogProductsHref: string
  providersHref: string
  result: ProviderImportResultView
}) {
  const failureCount = result.items.filter((item) => item.status !== "imported").length
  return (
    <section
      aria-labelledby="provider-import-result-title"
      className={
        failureCount > 0
          ? "border-destructive/25 bg-destructive/5 rounded border p-4"
          : "border-primary/25 bg-primary/5 rounded border p-4"
      }
      role="status"
    >
      <h3
        className="flex items-center gap-2 text-sm font-semibold"
        id="provider-import-result-title"
      >
        {failureCount > 0 ? (
          <WarningCircleIcon aria-hidden className="text-destructive" />
        ) : (
          <CheckCircleIcon aria-hidden className="text-primary" weight="fill" />
        )}
        Import {result.status.replaceAll("_", " ")}
      </h3>
      <p className="text-muted-foreground mt-1 text-xs">
        {result.items.length - failureCount} imported · {failureCount} failed · request {result.id}
      </p>
      {failureCount > 0 ? (
        <ul className="mt-3 space-y-1 text-xs">
          {result.items
            .filter((item) => item.status !== "imported")
            .map((item) => (
              <li key={item.providerProductIdentifier}>
                {item.providerProductIdentifier} · {item.errorCode ?? item.status}
              </li>
            ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
        <a className="text-primary" href={catalogProductsHref}>
          Review imported Products and assign Plans
        </a>
        <a className="text-primary" href={providersHref}>
          Select the active provider
        </a>
      </div>
    </section>
  )
}
