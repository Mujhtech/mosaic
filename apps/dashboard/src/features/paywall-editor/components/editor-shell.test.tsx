import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useLayoutEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { EditorShell } from "@/features/paywall-editor/components/editor-shell"
import { PaywallEditorProviders } from "@/features/paywall-editor/components/paywall-editor-workspace"
import { DEFAULT_MOCK_PRODUCTS } from "@/features/paywall-editor/constants/editor-constants"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

function InvalidEditorHarness() {
  const { document } = useEditorStore()
  const editor = useEditorActions()

  useLayoutEffect(() => {
    if (document) return
    const invalid = cloneValue(EDITOR_TEMPLATES[0]!.document)
    const headline = findNode(invalid, "headline")
    if (headline?.type !== "text") throw new Error("Expected headline")
    headline.value.default = ""
    invalid.localization.locales.en!.strings[headline.value.localizationKey] = ""
    editor.loadTemplate(invalid)
  }, [document, editor])

  if (!document) return null
  return (
    <EditorShell
      importError={null}
      mockProducts={DEFAULT_MOCK_PRODUCTS}
      mockPurchaseState="productAvailable"
      onImport={vi.fn()}
      onProductsChange={vi.fn()}
      onPurchaseStateChange={vi.fn()}
    />
  )
}

describe("EditorShell validation navigation", () => {
  const originalWidth = window.innerWidth

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 })
    window.dispatchEvent(new Event("resize"))
    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    vi.stubGlobal("WebSocket", undefined)
  })

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth })
    window.dispatchEvent(new Event("resize"))
    vi.unstubAllGlobals()
  })

  it("uses export failure to open compact Properties and focus the exact invalid field", async () => {
    render(
      <PaywallEditorProviders>
        <InvalidEditorHarness />
      </PaywallEditorProviders>,
    )

    fireEvent.click(await screen.findByRole("button", { name: "Export" }))

    const sheet = await screen.findByRole("dialog", { name: "Properties" })
    const field = within(sheet).getByRole("textbox", { name: "Text" })
    await waitFor(() => expect(field).toHaveFocus())
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(within(sheet).getByRole("alert")).toHaveTextContent("Visible text cannot be empty.")
  })
})
