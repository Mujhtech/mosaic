import { fireEvent, render, screen } from "@testing-library/react"
import { act, useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AUTOSAVE_DELAY_MS,
  DEFAULT_MOCK_PRODUCTS,
} from "@/features/paywall-editor/constants/editor-constants"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { useDraftAutosave } from "@/features/paywall-editor/hooks/use-draft-autosave"
import { readLocalProjectResult } from "@/features/paywall-editor/mutations/local-project-file"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type {
  MockProductDefinition,
  MockPurchaseState,
} from "@/features/paywall-editor/types/editor"

function AutosaveHarness({
  mockProducts,
  mockPurchaseState,
}: {
  mockProducts: readonly MockProductDefinition[]
  mockPurchaseState: MockPurchaseState
}) {
  const { document } = useEditorStore()
  const { loadTemplate, setLocale, setTextScale } = useEditorActions()
  const status = useDraftAutosave(mockPurchaseState, mockProducts)

  useEffect(() => {
    if (!document) loadTemplate(EDITOR_TEMPLATES[0]!.document)
  }, [document, loadTemplate])

  return (
    <div>
      <span data-testid="autosave-status">{status}</span>
      <button type="button" onClick={() => setLocale("ar")}>
        Arabic
      </button>
      <button type="button" onClick={() => setTextScale(1.8)}>
        Large text
      </button>
    </div>
  )
}

describe("draft autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => vi.useRealTimers())

  async function flushAutosave() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    })
  }

  it("persists and restores locale, text scale, and mock-commerce-only changes", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem")
    const { rerender } = render(
      <EditorStoreProvider>
        <AutosaveHarness
          mockProducts={DEFAULT_MOCK_PRODUCTS}
          mockPurchaseState="productAvailable"
        />
      </EditorStoreProvider>,
    )

    await flushAutosave()
    expect(screen.getByTestId("autosave-status")).toHaveTextContent("saved")
    expect(storageSpy).toHaveBeenCalledTimes(2)
    expect(readLocalProjectResult()).toMatchObject({
      status: "valid",
      project: { preview: { locale: "en", textScale: 1 } },
    })

    fireEvent.click(screen.getByRole("button", { name: "Arabic" }))
    await flushAutosave()
    expect(storageSpy).toHaveBeenCalledTimes(4)
    expect(readLocalProjectResult()).toMatchObject({
      status: "valid",
      project: { preview: { locale: "ar", textScale: 1 } },
    })

    fireEvent.click(screen.getByRole("button", { name: "Large text" }))
    await flushAutosave()
    expect(storageSpy).toHaveBeenCalledTimes(6)
    expect(readLocalProjectResult()).toMatchObject({
      status: "valid",
      project: { preview: { locale: "ar", textScale: 1.8 } },
    })

    const repricedProducts: readonly MockProductDefinition[] = DEFAULT_MOCK_PRODUCTS.map(
      (product) =>
        product.availability === "available"
          ? { ...product, localizedPrice: `Test ${product.localizedPrice}` }
          : product,
    )
    rerender(
      <EditorStoreProvider>
        <AutosaveHarness mockProducts={repricedProducts} mockPurchaseState="purchaseFailure" />
      </EditorStoreProvider>,
    )
    await flushAutosave()
    expect(storageSpy).toHaveBeenCalledTimes(8)
    expect(readLocalProjectResult()).toMatchObject({
      status: "valid",
      project: {
        preview: { locale: "ar", textScale: 1.8 },
        mockCommerce: {
          state: {
            purchaseOutcome: "purchaseFailed",
            products: [
              { productReferenceId: "monthly-plan", localizedPrice: "Test $7.99" },
              { productReferenceId: "yearly-plan", localizedPrice: "Test $59.99" },
            ],
          },
        },
      },
    })
  })
})
