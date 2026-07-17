import { useState } from "react"

import { MOCK_PURCHASE_STATES } from "@/features/paywall-editor/constants/editor-constants"
import { useEditorStore } from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MockProductDefinition,
  MockPurchaseState,
} from "@/features/paywall-editor/types/editor"
import { resolveLocalizedText } from "@/features/paywall-editor/utils/document-tree"

const CONTROL_CLASS =
  "border-input bg-background focus-visible:ring-ring w-full rounded-md border px-2 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"

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
    <div className="border-border rounded-lg border p-3">
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
