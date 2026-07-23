import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner"
import { productsQueryOptions } from "@/features/catalog/queries/catalog-query"
import { MOCK_PURCHASE_STATES } from "@/features/paywall-editor/constants/editor-constants"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import { useStudioSource } from "@/features/paywall-editor/stores/use-studio-source"
import type {
  MockProductDefinition,
  MockPurchaseState,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor"
import { hostedStudioHref, type StudioSource } from "@/features/paywall-editor/types/studio-source"
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree"
import { ApiError } from "@/lib/api/errors"

const CONTROL_CLASS =
  "border-input bg-background focus-visible:ring-ring w-full rounded border px-2 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"

function availableMock(productReferenceId: string): MockProductDefinition {
  return {
    productReferenceId,
    availability: "available",
    kind: "subscription",
    localizedPrice: "$0.00",
    currencyCode: "USD",
    billingPeriod: { unit: "month", value: 1 },
  }
}

function MockProductBinding({
  label,
  product,
  onChange,
}: {
  label: string
  product: MockProductDefinition
  onChange: (product: MockProductDefinition) => void
}) {
  const [draftPrice, setDraftPrice] = useState(
    product.availability === "available" ? product.localizedPrice : "$0.00",
  )
  const availabilityId = `mock-availability-${product.productReferenceId}`
  const priceId = `mock-price-${product.productReferenceId}`

  return (
    <div className="border-border rounded border p-3">
      <div className="mb-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-[11px]">{product.productReferenceId}</p>
      </div>
      <label
        className="text-muted-foreground mb-1 block text-xs font-medium"
        htmlFor={availabilityId}
      >
        Mock availability
      </label>
      <select
        id={availabilityId}
        className={CONTROL_CLASS}
        aria-label={`${label} mock availability`}
        value={product.availability}
        onChange={(event) => {
          onChange(
            event.target.value === "available"
              ? availableMock(product.productReferenceId)
              : {
                  productReferenceId: product.productReferenceId,
                  availability: "unavailable",
                  reason: "notConfigured",
                },
          )
        }}
      >
        <option value="available">Available</option>
        <option value="unavailable">Not configured</option>
      </select>
      {product.availability === "available" ? (
        <div className="mt-3">
          <label className="text-muted-foreground mb-1 block text-xs font-medium" htmlFor={priceId}>
            Local price
          </label>
          <input
            id={priceId}
            className={CONTROL_CLASS}
            aria-label={`${label} local price`}
            value={draftPrice}
            onChange={(event) => setDraftPrice(event.target.value)}
            onBlur={() => {
              if (draftPrice !== product.localizedPrice) {
                onChange({ ...product, localizedPrice: draftPrice })
              }
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function HostedCatalogProductBindings() {
  const source = useStudioSource()
  const { document, currentLocale } = useEditorStore()
  const editor = useEditorActions()
  if (source.kind !== "hosted") return null
  return (
    <HostedCatalogProductBindingsContent
      currentLocale={currentLocale}
      document={document}
      onBind={(referenceId, productId) =>
        editor.updateDocument((current) => ({
          ...current,
          products: current.products.map((product) =>
            product.id === referenceId ? { ...product, productId } : product,
          ),
        }))
      }
      source={source}
    />
  )
}

function HostedCatalogProductBindingsContent({
  currentLocale,
  document,
  onBind,
  source,
}: {
  currentLocale: string
  document: MosaicDocument | null
  onBind: (referenceId: string, productId: string) => void
  source: Extract<StudioSource, { kind: "hosted" }>
}) {
  const catalog = useQuery(productsQueryOptions(source.projectId))
  const products = catalog.data?.items.filter((product) => product.status !== "archived") ?? []
  const catalogHref = `/organizations/${encodeURIComponent(source.organizationId)}/projects/${encodeURIComponent(source.projectId)}/catalog/products`
  const returnTo = hostedStudioHref(source)

  if (catalog.error instanceof ApiError && catalog.error.status === 401) {
    return <HostedAccessBanner compact returnTo={returnTo} />
  }

  return (
    <section aria-labelledby="catalog-product-bindings-title" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold" id="catalog-product-bindings-title">
          Catalog Product bindings
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs leading-5">
          Bind each paywall Product Reference to a stable Project Product. Mock preview prices and
          outcomes remain separate below.
        </p>
      </div>
      {catalog.isPending ? (
        <p aria-live="polite" className="text-muted-foreground text-xs">
          Loading Project Products…
        </p>
      ) : catalog.error ? (
        <div className="border-destructive/25 bg-destructive/5 rounded border p-3" role="alert">
          <p className="text-destructive text-xs">
            {catalog.error instanceof ApiError && catalog.error.status === 403
              ? "You do not have permission to view this Project’s Products. Your Draft remains editable."
              : catalog.error.message}
          </p>
          <Button
            className="mt-2"
            onClick={() => void catalog.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry Products
          </Button>
        </div>
      ) : products.length === 0 ? (
        <div className="border-border rounded border border-dashed p-3 text-xs">
          <p className="font-medium">No active Project Products</p>
          <p className="text-muted-foreground mt-1 leading-5">
            Create a Product, then return here to bind its stable Mosaic Product ID.
          </p>
        </div>
      ) : document ? (
        <div className="space-y-2">
          {document.products.map((reference) => {
            const selected = products.find((product) => product.id === reference.productId)
            const label = resolveLocalizedText(document, reference.label, currentLocale)
            return (
              <label className="border-border grid gap-1 rounded border p-3" key={reference.id}>
                <span className="text-xs font-medium">{label}</span>
                <select
                  aria-label={`Catalog Product for ${label}`}
                  className={CONTROL_CLASS}
                  onChange={(event) => onBind(reference.id, event.currentTarget.value)}
                  value={reference.productId}
                >
                  {!selected ? (
                    <option value={reference.productId}>Current ID · {reference.productId}</option>
                  ) : null}
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.internalName} · {product.status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground font-mono text-[10px] break-all">
                  {reference.productId}
                </span>
                {selected?.metadataSource === "mock" ? (
                  <span className="text-muted-foreground text-[11px]">
                    Simulated metadata only; publishing requires acknowledgement.
                  </span>
                ) : selected ? (
                  <span className="text-muted-foreground text-[11px]">
                    Connected Product identity only. Provider price and availability are unavailable
                    in this response; simulated preview remains active.
                  </span>
                ) : null}
              </label>
            )
          })}
        </div>
      ) : null}
      <a className={buttonVariants({ size: "sm", variant: "outline" })} href={catalogHref}>
        Manage Project Products
      </a>
    </section>
  )
}

export function MockCommercePanel({
  mockProducts,
  mockPurchaseState,
  onProductsChange,
  onPurchaseStateChange,
}: {
  mockProducts: readonly MockProductDefinition[]
  mockPurchaseState: MockPurchaseState
  onProductsChange: (products: MockProductDefinition[]) => void
  onPurchaseStateChange: (state: MockPurchaseState) => void
}) {
  const { document, currentLocale } = useEditorStore()
  const source = useStudioSource()

  function updateProduct(nextProduct: MockProductDefinition) {
    const nextProducts = mockProducts.map((product) =>
      product.productReferenceId === nextProduct.productReferenceId ? nextProduct : product,
    )
    onProductsChange(nextProducts)
    if (nextProduct.availability === "available") {
      onPurchaseStateChange("productAvailable")
    } else if (nextProducts.every((product) => product.availability === "unavailable")) {
      onPurchaseStateChange("productUnavailable")
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="mock-commerce-title">
      <HostedCatalogProductBindings />
      {source.kind === "hosted" ? <hr className="border-border" /> : null}
      <div>
        <h2 id="mock-commerce-title" className="text-sm font-semibold">
          Test purchase
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Safe local outcomes; no store purchase
        </p>
      </div>
      <div>
        <label
          className="text-muted-foreground mb-1 block text-xs font-medium"
          htmlFor="mock-outcome"
        >
          Preview state
        </label>
        <select
          id="mock-outcome"
          className={CONTROL_CLASS}
          value={mockPurchaseState}
          onChange={(event) => onPurchaseStateChange(event.target.value as MockPurchaseState)}
        >
          {MOCK_PURCHASE_STATES.map((state) => (
            <option key={state.value} value={state.value}>
              {state.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <h3 className="text-xs font-semibold">Mock product bindings</h3>
        {mockProducts.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-xs">
            This paywall does not declare a product to bind.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {mockProducts.map((product) => {
              const reference = document?.products.find(
                (entry) => entry.id === product.productReferenceId,
              )
              const label =
                reference && document
                  ? resolveLocalizedText(document, reference.label, currentLocale)
                  : "Imported product"
              return (
                <MockProductBinding
                  key={`${product.productReferenceId}:${product.availability}`}
                  label={label}
                  product={product}
                  onChange={updateProduct}
                />
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
