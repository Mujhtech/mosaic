import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { EditorStoreProvider } from "@/features/paywall-editor/stores/editor-store-context"
import { StudioWorkspaceStoreProvider } from "@/features/paywall-editor/stores/studio-workspace-store-context"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode } from "@/features/paywall-editor/utils/document-tree"
import {
  InspectorHarness,
  documentWithBlock,
  expectValidationIssueFocus,
  getInspectorSection,
  openInspectorSection,
  renderInspector,
  renderedSectionTitles,
} from "./property-inspector-test-support"

describe("property inspector safety", () => {
  it("keeps product binding contextual to the selected Product Card", async () => {
    renderInspector("monthly-card")
    const product = await screen.findByLabelText("Product")
    expect(product).toHaveValue("monthly-plan")
    expect(within(product).getByRole("option", { name: "Yearly" })).toBeDisabled()
    expect(screen.getByTestId("bindings")).toHaveTextContent("monthly-plan,yearly-plan")
  })

  it("edits Product Card Default and Selected states with explicit inheritance", async () => {
    renderInspector("monthly-card")
    const section = await waitFor(() => getInspectorSection("Appearance"))
    const card = within(section)
    await waitFor(() =>
      expect(screen.getByTestId("product-layer-preview")).toHaveTextContent("monthly-card:default"),
    )

    fireEvent.click(card.getByRole("button", { name: "Selected" }))
    await waitFor(() =>
      expect(screen.getByTestId("product-layer-preview")).toHaveTextContent(
        "monthly-card:selected",
      ),
    )
    expect(screen.getByTestId("inspector-undo-count")).toHaveTextContent("0")
    fireEvent.click(card.getByRole("button", { name: "Reset selected appearance" }))
    expect(card.getByLabelText("Fill")).toHaveValue("surface.default")
    expect(screen.getByTestId("selected-card-style")).toHaveTextContent("{}")
    expect(card.getByLabelText("Stroke")).toBeInTheDocument()
    expect(card.getByLabelText("Weight")).toBeInTheDocument()
    expect(card.getByLabelText("Corner radius")).toBeInTheDocument()
    expect(card.getByRole("group", { name: "Padding" })).toBeInTheDocument()

    const selectedBackground = card.getByLabelText("Fill")
    fireEvent.focus(selectedBackground)
    fireEvent.change(selectedBackground, { target: { value: "#112233FF" } })
    fireEvent.blur(selectedBackground)
    expect(screen.getByTestId("selected-card-style")).toHaveTextContent("#112233FF")
    fireEvent.click(card.getByRole("button", { name: "Reset fill to Default" }))
    expect(card.getByLabelText("Fill")).toHaveValue("surface.default")
    expect(screen.getByTestId("selected-card-style")).toHaveTextContent("{}")

    fireEvent.focus(selectedBackground)
    fireEvent.change(selectedBackground, { target: { value: "#112233FF" } })
    fireEvent.blur(selectedBackground)

    fireEvent.click(card.getByRole("button", { name: "Default" }))
    expect(card.getByLabelText("Fill")).toHaveValue("surface.default")
    fireEvent.click(card.getByRole("button", { name: "Selected" }))
    expect(card.getByLabelText("Fill")).toHaveValue("#112233FF")
  })

  it("applies a colour token from the palette as one undoable editor change", async () => {
    renderInspector("close")
    await waitFor(() => expect(getInspectorSection("Background")).toBeInTheDocument())
    openInspectorSection("Background")

    expect(screen.getByLabelText("Background")).toHaveValue("transparent")
    fireEvent.click(screen.getByRole("button", { name: "Open Background colour picker" }))
    const palette = await screen.findByRole("dialog", { name: "Background colour" })
    fireEvent.click(within(palette).getByRole("button", { name: "Action primary" }))

    expect(screen.getByLabelText("Background")).toHaveValue("action.primary")
    expect(screen.getByLabelText("Background opacity")).toHaveValue(100)
    expect(screen.getByTestId("inspector-undo-count")).toHaveTextContent("1")

    fireEvent.click(screen.getByRole("button", { name: "Undo editor change" }))
    expect(screen.getByLabelText("Background")).toHaveValue("transparent")
  })

  it("exposes Product Badge content alongside placement, layout, and state styling", async () => {
    renderInspector("yearly-badge")
    await waitFor(() => expect(getInspectorSection("Badge")).toBeInTheDocument())

    expect(renderedSectionTitles()).toEqual([
      "Badge",
      "Content",
      "Layout",
      "Size",
      "Appearance",
      "Advanced",
    ])
    const content = within(openInspectorSection("Content"))
    expect(content.getByRole("button", { name: "Edit Text in Product Badge" })).toBeVisible()
    expect(content.getByText(/product variables work inside Text/)).toBeVisible()
  })

  it("authors Product Card sizing, including fixed width", async () => {
    renderInspector("monthly-card")
    const size = within(await waitFor(() => openInspectorSection("Size")))

    fireEvent.change(size.getByRole("combobox", { name: "Width behaviour" }), {
      target: { value: "fixed" },
    })

    expect(size.getByRole("spinbutton", { name: "Fixed width" })).toHaveValue(320)
    expect(screen.getByTestId("inspector-document")).toHaveTextContent(
      '"width":{"mode":"fixed","value":320}',
    )

    fireEvent.change(size.getByRole("combobox", { name: "Width behaviour" }), {
      target: { value: "fill" },
    })
    expect(size.getByRole("combobox", { name: "Width behaviour" })).toHaveValue("fill")
    expect(size.getByText(/horizontal axis is unbounded/)).toBeVisible()
    expect(screen.getByTestId("inspector-document")).toHaveTextContent('"sizing":{"width":"fill"')
  })

  it("keeps media background selection valid with inline asset recovery", async () => {
    renderInspector("close")
    openInspectorSection("Background")

    expect(screen.getByRole("combobox", { name: "Type" })).toHaveAccessibleName("Type")
    fireEvent.click(screen.getByRole("button", { name: "Add video" }))

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("video"))
    expect(screen.getByTestId("inspector-document")).toHaveTextContent(
      '"type":"video","id":"video-1"',
    )
    expect(screen.getByTestId("inspector-document")).toHaveTextContent(
      '"type":"video","assetId":"video-1"',
    )
  })

  it("opens Selected card state when validation targets an override", async () => {
    const invalidDocument = cloneValue(EDITOR_TEMPLATES[0]!.document)
    const card = findNode(invalidDocument, "monthly-card")
    if (!card || card.type !== "productCard") {
      throw new Error("Missing Product Card")
    }
    card.styles.selected.background = { type: "color", value: "#123" }

    await expectValidationIssueFocus({
      address: "styles.selected.background.value",
      initialDocument: invalidDocument,
      selection: "monthly-card",
    })
  })

  it.each([
    ["stack", "Flow", "Layout"],
    ["carousel", "Initial page", "Content"],
    ["switch", "Switch label", "Content"],
    ["countdown", "Ends at", "Content"],
  ] as const)(
    "provides contextual Protocol 0.2 coverage for %s",
    async (type, fieldLabel, primarySection) => {
      const fixture = documentWithBlock(type)
      render(
        <StudioWorkspaceStoreProvider storage={null}>
          <EditorStoreProvider>
            <InspectorHarness initialDocument={fixture.document} selection={fixture.nodeId} />
          </EditorStoreProvider>
        </StudioWorkspaceStoreProvider>,
      )

      await waitFor(() => expect(getInspectorSection(primarySection)).toBeInTheDocument())
      expect(screen.getByLabelText(fieldLabel)).toBeInTheDocument()
      expect(getInspectorSection("Visibility")).toBeInTheDocument()
      expect(getInspectorSection("Advanced")).not.toHaveAttribute("open")
      expect(getInspectorSection(primarySection).className).not.toContain("rounded")
    },
  )
})
