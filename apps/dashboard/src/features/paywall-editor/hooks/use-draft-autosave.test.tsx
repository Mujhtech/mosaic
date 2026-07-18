import { fireEvent, render, screen } from "@testing-library/react"
import { act, useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AUTOSAVE_DELAY_MS,
  DEFAULT_MOCK_PRODUCTS,
} from "@/features/paywall-editor/constants/editor-constants"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  useDraftAutosave,
  useDraftAutosaveController,
} from "@/features/paywall-editor/hooks/use-draft-autosave"
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
import { findNode } from "@/features/paywall-editor/utils/document-tree"

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

function RetryAutosaveHarness() {
  const { document } = useEditorStore()
  const { loadTemplate } = useEditorActions()
  const { retry, status } = useDraftAutosaveController("productAvailable")

  useEffect(() => {
    if (!document) loadTemplate(EDITOR_TEMPLATES[0]!.document)
  }, [document, loadTemplate])

  return (
    <div>
      <span data-testid="retry-autosave-status">{status}</span>
      <button type="button" onClick={retry}>
        Retry autosave
      </button>
    </div>
  )
}

function FlushAutosaveHarness() {
  const { document } = useEditorStore()
  const { loadTemplate } = useEditorActions()
  const { flush, retry, status } = useDraftAutosaveController("productAvailable")

  useEffect(() => {
    if (!document) loadTemplate(EDITOR_TEMPLATES[0]!.document)
  }, [document, loadTemplate])

  return (
    <div>
      <span data-testid="flush-autosave-status">{status}</span>
      <button type="button" onClick={flush}>
        Flush before Back
      </button>
      <button type="button" onClick={retry}>
        Retry flushed autosave
      </button>
    </div>
  )
}

function TransactionAutosaveHarness() {
  const { document } = useEditorStore()
  const {
    beginDocumentTransaction,
    commitDocumentTransaction,
    loadTemplate,
    updateComponentInTransaction,
  } = useEditorActions()
  const status = useDraftAutosave("productAvailable")

  useEffect(() => {
    if (!document) loadTemplate(EDITOR_TEMPLATES[0]!.document)
  }, [document, loadTemplate])

  return (
    <div>
      <span data-testid="transaction-autosave-status">{status}</span>
      <button type="button" onClick={beginDocumentTransaction}>
        Begin document transaction
      </button>
      <button
        type="button"
        onClick={() => {
          updateComponentInTransaction("headline", (node) =>
            node.type === "text"
              ? { ...node, value: { ...node.value, default: "Transient headline" } }
              : node,
          )
          updateComponentInTransaction("headline", (node) =>
            node.type === "text"
              ? { ...node, value: { ...node.value, default: "Committed headline" } }
              : node,
          )
        }}
      >
        Update headline in transaction
      </button>
      <button type="button" onClick={commitDocumentTransaction}>
        Commit document transaction
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

  it("does not autosave preview-only context and includes its latest values in a later mock save", async () => {
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
    expect(storageSpy).toHaveBeenCalledTimes(2)
    expect(readLocalProjectResult()).toMatchObject({
      status: "valid",
      project: { preview: { locale: "en", textScale: 1 } },
    })

    fireEvent.click(screen.getByRole("button", { name: "Large text" }))
    await flushAutosave()
    expect(storageSpy).toHaveBeenCalledTimes(2)
    expect(readLocalProjectResult()).toMatchObject({
      status: "valid",
      project: { preview: { locale: "en", textScale: 1 } },
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
    expect(storageSpy).toHaveBeenCalledTimes(4)
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

  it("retries the current fingerprint after a failed storage write", async () => {
    const originalSetItem = Storage.prototype.setItem
    let failNextWrite = true
    const storageSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (failNextWrite) {
        failNextWrite = false
        throw new DOMException("Storage is unavailable", "QuotaExceededError")
      }
      originalSetItem.call(this, key, value)
    })

    render(
      <EditorStoreProvider>
        <RetryAutosaveHarness />
      </EditorStoreProvider>,
    )

    await flushAutosave()
    expect(screen.getByTestId("retry-autosave-status")).toHaveTextContent("failed")
    expect(storageSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Retry autosave" }))

    expect(screen.getByTestId("retry-autosave-status")).toHaveTextContent("saved")
    expect(storageSpy).toHaveBeenCalledTimes(3)
    expect(readLocalProjectResult()).toMatchObject({ status: "valid" })
  })

  it("flushes the pending local project synchronously before Back", () => {
    render(
      <EditorStoreProvider>
        <FlushAutosaveHarness />
      </EditorStoreProvider>,
    )

    expect(screen.getByTestId("flush-autosave-status")).toHaveTextContent("saving")
    fireEvent.click(screen.getByRole("button", { name: "Flush before Back" }))

    expect(screen.getByTestId("flush-autosave-status")).toHaveTextContent("saved")
    expect(readLocalProjectResult()).toMatchObject({ status: "valid" })
  })

  it("keeps a failed synchronous Back flush pending for the exact retry", () => {
    const originalSetItem = Storage.prototype.setItem
    let failNextWrite = true
    const storageSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (failNextWrite) {
        failNextWrite = false
        throw new DOMException("Storage is unavailable", "QuotaExceededError")
      }
      originalSetItem.call(this, key, value)
    })
    render(
      <EditorStoreProvider>
        <FlushAutosaveHarness />
      </EditorStoreProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Flush before Back" }))
    expect(screen.getByTestId("flush-autosave-status")).toHaveTextContent("failed")
    expect(storageSpy).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Retry flushed autosave" }))
    expect(screen.getByTestId("flush-autosave-status")).toHaveTextContent("saved")
    expect(storageSpy).toHaveBeenCalledTimes(3)
    expect(readLocalProjectResult()).toMatchObject({ status: "valid" })
  })

  it("does not autosave transient document states and writes once after commit", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem")
    render(
      <EditorStoreProvider>
        <TransactionAutosaveHarness />
      </EditorStoreProvider>,
    )
    await flushAutosave()
    expect(screen.getByTestId("transaction-autosave-status")).toHaveTextContent("saved")
    storageSpy.mockClear()

    fireEvent.click(screen.getByRole("button", { name: "Begin document transaction" }))
    fireEvent.click(screen.getByRole("button", { name: "Update headline in transaction" }))
    await flushAutosave()
    expect(storageSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Commit document transaction" }))
    await flushAutosave()

    expect(storageSpy).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId("transaction-autosave-status")).toHaveTextContent("saved")
    const saved = readLocalProjectResult()
    expect(saved.status).toBe("valid")
    if (saved.status !== "valid") throw new Error("Expected a valid local project")
    expect(findNode(saved.project.document, "headline")).toMatchObject({
      value: { default: "Committed headline" },
    })
  })
})
