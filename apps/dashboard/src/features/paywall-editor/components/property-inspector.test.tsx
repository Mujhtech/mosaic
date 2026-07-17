import { fireEvent, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { describe, expect, it } from "vitest"

import { PropertyInspector } from "@/features/paywall-editor/components/property-inspector"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

function InspectorHarness({ selection = "plans" }: { selection?: "plans" | "headline" }) {
  const { document, selectedComponentId } = useEditorStore()
  const { loadTemplate, selectComponent, undo } = useEditorActions()

  useEffect(() => {
    if (!document) loadTemplate(EDITOR_TEMPLATES[0]!.document)
    else if (selectedComponentId !== selection) selectComponent(selection)
  }, [document, loadTemplate, selectComponent, selectedComponentId, selection])

  const selector = document ? findNode(document, "plans") : null
  return (
    <>
      <PropertyInspector />
      <button type="button" onClick={undo}>
        Undo editor change
      </button>
      <output data-testid="bindings">
        {selector?.type === "productSelector" ? selector.productReferenceIds.join(",") : ""}
      </output>
    </>
  )
}

describe("property inspector safety", () => {
  it("keeps an unbound product available so it can be rebound", () => {
    render(
      <EditorStoreProvider>
        <InspectorHarness />
      </EditorStoreProvider>,
    )

    const monthly = screen.getByRole("checkbox", { name: /monthly/i })
    expect(monthly).toBeChecked()
    fireEvent.click(monthly)

    expect(screen.getByRole("checkbox", { name: /monthly/i })).not.toBeChecked()
    expect(screen.getByTestId("bindings")).not.toHaveTextContent("monthly-plan")

    fireEvent.click(screen.getByRole("checkbox", { name: /monthly/i }))
    expect(screen.getByRole("checkbox", { name: /monthly/i })).toBeChecked()
    expect(screen.getByTestId("bindings")).toHaveTextContent("monthly-plan")
  })

  it("refreshes a localized form value after undo on the same selection", () => {
    render(
      <EditorStoreProvider>
        <InspectorHarness selection="headline" />
      </EditorStoreProvider>,
    )

    const headline = screen.getByRole("textbox", { name: "Text" })
    expect(headline).toHaveValue("Build a paywall people understand")
    fireEvent.change(headline, { target: { value: "A changed headline" } })
    fireEvent.blur(headline)
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue("A changed headline")

    fireEvent.click(screen.getByRole("button", { name: "Undo editor change" }))
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue(
      "Build a paywall people understand",
    )
  })
})
