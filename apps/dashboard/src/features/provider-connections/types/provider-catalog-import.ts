export interface ProviderCatalogProductView {
  applicationId: string
  displayName?: string
  id: string
  importable: boolean
  state: string
  storeIdentifier: string
  type: string
}

export interface ProviderCatalogEntitlementView {
  displayName: string
  id: string
  lookupKey: string
  state: string
}

export interface ProviderCatalogPackageView {
  displayName: string
  id: string
  lookupKey: string
  productIds: string[]
}

export interface ProviderCatalogOfferingView {
  displayName: string
  id: string
  isCurrent: boolean
  lookupKey: string
  packages: ProviderCatalogPackageView[]
  state: string
}

export interface ProviderCatalogPreviewView {
  entitlements: ProviderCatalogEntitlementView[]
  observedAt: string
  offerings: ProviderCatalogOfferingView[]
  products: ProviderCatalogProductView[]
}

export interface ProviderEntitlementImportSelection {
  existingEntitlementId?: string
  key?: string
  name?: string
  providerIdentifier: string
}

export interface ProviderProductImportSelection {
  applicationId: string
  entitlements: ProviderEntitlementImportSelection[]
  environmentId: string
  existingProductId?: string
  internalName?: string
  key?: string
  providerOfferingIdentifier?: string
  providerPackageIdentifier?: string
  providerProductIdentifier: string
}

export interface ProviderImportItemResult {
  errorCode?: string
  mappingId?: string
  mosaicProductId?: string
  providerProductIdentifier: string
  status: string
}

export interface ProviderImportResultView {
  id: string
  items: ProviderImportItemResult[]
  status: "completed" | "in_progress" | "partial"
}

export interface ProviderImportAttempt {
  idempotencyKey: string
  requestSignature: string
}

export function nextProviderImportAttempt(
  previous: ProviderImportAttempt | null,
  requestSignature: string,
  createKey: () => string,
): ProviderImportAttempt {
  if (previous?.requestSignature === requestSignature) return previous
  return { idempotencyKey: createKey(), requestSignature }
}

export function providerImportIdentifier(product: ProviderCatalogProductView): string {
  return product.id
}

export function providerEntitlementSelections(
  entitlements: readonly ProviderCatalogEntitlementView[],
  targets: Readonly<Record<string, string>>,
): ProviderEntitlementImportSelection[] {
  return entitlements.flatMap((entitlement) => {
    const target = targets[entitlement.id]
    if (!target) return []
    return [
      target === "new"
        ? {
            key: catalogKey(entitlement.lookupKey),
            name: entitlement.displayName || entitlement.lookupKey,
            providerIdentifier: entitlement.id,
          }
        : {
            existingEntitlementId: target,
            providerIdentifier: entitlement.id,
          },
    ]
  })
}

export function catalogKey(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^([^a-z])+/, "")
    .replace(/_+/g, "_")
    .replace(/[_-]+$/, "")
    .slice(0, 63)
  return normalized.length >= 2 ? normalized : `product_${normalized || "new"}`
}
