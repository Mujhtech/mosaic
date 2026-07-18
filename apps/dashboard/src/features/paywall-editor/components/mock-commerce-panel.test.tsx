import { fireEvent, render, screen } from "@testing-library/react"
import { useEffect, useState } from "react"
import { describe, expect, it } from "vitest"

import { MockCommercePanel } from "@/features/paywall-editor/components/mock-commerce-panel"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MockProductDefinition,
  MockPurchaseState,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

function Harness() {
  const { document } = useEditorStore()
  const { replaceDocument } = useEditorActions()
  const [products, setProducts] = useState<MockProductDefinition[]>([
    {
      productReferenceId: "starter-plan",
      availability: "unavailable",
      reason: "notConfigured",
    },
  ])
  const [purchaseState, setPurchaseState] = useState<MockPurchaseState>("productUnavailable")

  useEffect(() => {
    if (document) return
    const imported = cloneValue(EDITOR_TEMPLATES[0]!.document)
    imported.products = [
      {
        ...imported.products[0]!,
        id: "starter-plan",
        label: { default: "Starter", localizationKey: "paywall.products.monthly" },
      },
    ]
    imported.localization.locales.en!.strings["paywall.products.monthly"] = "Starter"
    const selector = findNode(imported, "plans")
    if (selector?.type === "productSelector") {
      selector.cards = [{ ...selector.cards[0]!, productReferenceId: "starter-plan" }]
      selector.initialProductCardId = selector.cards[0]!.id
    }
    replaceDocument(imported)
  }, [document, replaceDocument])

  return (
    <>
      <MockCommercePanel
        mockProducts={products}
        mockPurchaseState={purchaseState}
        onProductsChange={setProducts}
        onPurchaseStateChange={setPurchaseState}
      />
      <output aria-label="mock state">{JSON.stringify({ products, purchaseState })}</output>
    </>
  )
}

describe("mock commerce controls", () => {
  it("binds an imported product and commits its local price on blur", () => {
    render(
      <EditorStoreProvider>
        <Harness />
      </EditorStoreProvider>,
    )

    fireEvent.change(screen.getByLabelText("Starter mock availability"), {
      target: { value: "available" },
    })
    const price = screen.getByLabelText("Starter local price")
    fireEvent.change(price, { target: { value: "$4.99" } })
    fireEvent.blur(price)

    expect(screen.getByLabelText("mock state")).toHaveTextContent(
      '"productReferenceId":"starter-plan","availability":"available"',
    )
    expect(screen.getByLabelText("mock state")).toHaveTextContent('"localizedPrice":"$4.99"')
    expect(screen.getByLabelText("mock state")).toHaveTextContent(
      '"purchaseState":"productAvailable"',
    )
  })

  it("exposes deterministic empty and failed restore outcomes", () => {
    render(
      <EditorStoreProvider>
        <Harness />
      </EditorStoreProvider>,
    )

    const outcome = screen.getByLabelText("Preview state")
    expect(outcome).toHaveDisplayValue("Product unavailable")
    fireEvent.change(outcome, { target: { value: "restoreNoPurchases" } })
    expect(screen.getByLabelText("mock state")).toHaveTextContent(
      '"purchaseState":"restoreNoPurchases"',
    )
    fireEvent.change(outcome, { target: { value: "restoreFailure" } })
    expect(screen.getByLabelText("mock state")).toHaveTextContent(
      '"purchaseState":"restoreFailure"',
    )
  })
})
