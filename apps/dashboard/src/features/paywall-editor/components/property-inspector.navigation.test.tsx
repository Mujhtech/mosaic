import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { collectEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation"
import { EditorStoreProvider } from "@/features/paywall-editor/stores/editor-store-context"
import { StudioWorkspaceStoreProvider } from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type { ValidationIssue } from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { appendScreen, findNode } from "@/features/paywall-editor/utils/document-tree"
import {
  focusInspectorValidationIssue,
  getInspectorFieldId,
} from "@/features/paywall-editor/utils/property-inspector-navigation"
import {
  InspectorHarness,
  expectOnlySectionOpen,
  expectReadOnlyField,
  expectValidationIssueFocus,
  getInspectorSection,
  openInspectorSection,
  renderInspector,
  renderSeedMode,
  renderedPropertyAddresses,
} from "./property-inspector-test-support"

describe("property inspector safety", () => {
  it("allows the former start destination to become a Sheet", async () => {
    const appended = appendScreen(cloneValue(EDITOR_TEMPLATES[0]!.document))
    const document = { ...appended.document, initialScreenId: appended.screenId }

    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness initialDocument={document} selection={document.screens[0]!.layout.id} />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )

    const presentation = await screen.findByRole("combobox", { name: "Presentation" })
    expect(within(presentation).getByRole("option", { name: "Sheet" })).toBeEnabled()
    fireEvent.change(presentation, { target: { value: "sheet" } })
    await waitFor(() =>
      expect(screen.getByTestId("inspector-document")).toHaveTextContent(
        '"id":"main","presentation":{"type":"sheet"}',
      ),
    )
  })

  it("exposes Image sizing, appearance, visibility, and accessibility", async () => {
    renderSeedMode("image")

    await waitFor(() => expect(getInspectorSection("Content")).toBeInTheDocument())
    expectOnlySectionOpen("Content")
    expect(renderedPropertyAddresses()).toEqual(
      expect.arrayContaining([
        "assetId",
        "aspectRatio.enabled",
        "aspectRatio",
        "contentMode",
        "sizing.width",
        "sizing.height",
        "outerInsets",
        "appearance.background",
        "visibility.mode",
        "accessibility.hidden",
        "id",
        "type",
      ]),
    )
    expect(screen.getByRole("spinbutton", { name: "Aspect ratio" })).toHaveAttribute("min", "0")
    expect(screen.getByRole("spinbutton", { name: "Aspect ratio" })).toHaveAttribute("max", "10")
    openInspectorSection("Advanced")
    expectReadOnlyField("image-1", "type", "image")
    expect(screen.getByRole("combobox", { name: "Width behaviour" })).toHaveValue("fill")
  })

  it("exposes production Protocol 0.2 text controls progressively", async () => {
    renderInspector("headline")
    await screen.findByRole("textbox", { name: "Text" })

    expect(screen.getByLabelText("Colour")).toBeInTheDocument()
    expect(screen.getByLabelText("Line height")).toBeInTheDocument()
    expect(screen.getByLabelText("Width behaviour")).toBeInTheDocument()
    expect(screen.getByLabelText("Visibility")).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Outer spacing" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add accessibility label" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Limit lines" }))
    expect(screen.getByLabelText("Maximum lines")).toBeInTheDocument()
  })

  it("shows a contextual icon and ancestry breadcrumb without leaking machine IDs", async () => {
    const textRender = renderInspector("headline")

    const path = await screen.findByRole("navigation", { name: "Selected layer path" })
    expect(path).toHaveTextContent("Scroll Container/Content Stack/Text")
    expect(document.querySelector('[data-layer-type-icon="text"]')).toBeInTheDocument()
    textRender.unmount()

    const stackRender = renderInspector("paywall-content")
    await waitFor(() => expect(getInspectorSection("Layout")).toBeInTheDocument())
    expect(document.querySelector('[data-inspector-section="Children"]')).not.toBeInTheDocument()
    stackRender.unmount()

    const productRender = renderInspector("monthly-card")
    const productInspector = await screen.findByRole("region", { name: "Properties" })
    expect(within(productInspector).queryByText("monthly-plan")).not.toBeInTheDocument()
    expect(within(productInspector).queryByText("yearly-plan")).not.toBeInTheDocument()
    expect(within(productInspector).getByRole("option", { name: "Monthly" })).toHaveValue(
      "monthly-plan",
    )
    productRender.unmount()

    renderInspector("purchase")
    openInspectorSection("Actions")
    expect(screen.queryByText("plans")).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Product Selector" })).toHaveValue("plans")
  })

  it("keeps structure in Layers while using group semantics for product sets", async () => {
    const stackRender = renderInspector("paywall-content")
    await waitFor(() => expect(getInspectorSection("Layout")).toBeInTheDocument())
    expect(screen.queryByRole("group", { name: "Child summary" })).not.toBeInTheDocument()
    stackRender.unmount()

    renderInspector("plans")
    expect(await screen.findByRole("button", { name: "Add Product Card" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit Monthly Product Card" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Edit Yearly Product Card (initial selection)" }),
    ).toBeInTheDocument()
  })

  it("focuses canonical localized-default diagnostics on the editable content field", async () => {
    const invalidDocument = cloneValue(EDITOR_TEMPLATES[0]!.document)
    const headline = findNode(invalidDocument, "headline")
    if (!headline || headline.type !== "text") throw new Error("Missing headline")
    headline.value.default = "Inline default does not match the catalog"
    const issue = collectEditorValidation(invalidDocument).issues.find((candidate) =>
      candidate.documentPath.endsWith("/value/default"),
    )
    if (!issue) throw new Error("Missing canonical default diagnostic")

    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness
            initialDocument={invalidDocument}
            issues={[issue]}
            selection="headline"
          />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )

    const field = await screen.findByRole("textbox", { name: "Text" })
    expect(issue.property).toBe("value")
    expect(field).toHaveAttribute("aria-invalid", "true")
    field.closest("details")?.removeAttribute("open")
    expect(focusInspectorValidationIssue(issue)).toBe(true)
    expect(field.closest("details")).toHaveAttribute("open")
    expect(field).toHaveFocus()
  })

  it("opens Advanced for canonical localization-key and feature-item-ID diagnostics", async () => {
    const invalidTextDocument = cloneValue(EDITOR_TEMPLATES[0]!.document)
    const headline = findNode(invalidTextDocument, "headline")
    if (!headline || headline.type !== "text") throw new Error("Missing headline")
    headline.value.localizationKey = "InvalidKey"
    const keyIssue = collectEditorValidation(invalidTextDocument).issues.find(
      (candidate) => candidate.code === "schema.pattern" && candidate.componentId === "headline",
    )
    if (!keyIssue) throw new Error("Missing canonical localization-key diagnostic")

    const textRender = render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness
            initialDocument={invalidTextDocument}
            issues={[keyIssue]}
            selection="headline"
          />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )
    await waitFor(() => expect(getInspectorSection("Advanced")).toBeInTheDocument())
    expect(getInspectorSection("Advanced")).not.toHaveAttribute("open")
    expect(focusInspectorValidationIssue(keyIssue)).toBe(true)
    expect(getInspectorSection("Advanced")).toHaveAttribute("open")
    expectReadOnlyField("headline", "value.localizationKey", "InvalidKey")
    textRender.unmount()

    const invalidFeatureDocument = cloneValue(EDITOR_TEMPLATES[1]!.document)
    const features = findNode(invalidFeatureDocument, "features")
    if (!features || features.type !== "featureList" || !features.items[0]) {
      throw new Error("Missing feature list")
    }
    features.items[0].id = "InvalidItem"
    const itemIssue = collectEditorValidation(invalidFeatureDocument).issues.find(
      (candidate) => candidate.property === "items.InvalidItem.id",
    )
    if (!itemIssue) throw new Error("Missing canonical feature-item diagnostic")

    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness
            initialDocument={invalidFeatureDocument}
            issues={[itemIssue]}
            selection="features"
          />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )
    await waitFor(() => expect(getInspectorSection("Advanced")).toBeInTheDocument())
    expect(focusInspectorValidationIssue(itemIssue)).toBe(true)
    expectReadOnlyField("features", "items.InvalidItem.id", "InvalidItem")
  })

  it("focuses exact nested padding, accessibility, action, fallback, and feature fields", async () => {
    const invalidPadding = cloneValue(EDITOR_TEMPLATES[0]!.document)
    invalidPadding.screens[0]!.layout.content.padding.top = -1
    await expectValidationIssueFocus({
      address: "padding.top",
      initialDocument: invalidPadding,
      selection: "paywall-content",
    })

    const invalidHeading = cloneValue(EDITOR_TEMPLATES[0]!.document)
    const heading = findNode(invalidHeading, "headline")
    if (!heading || heading.type !== "text" || heading.accessibility.role !== "heading") {
      throw new Error("Missing heading")
    }
    heading.accessibility.level = 7
    await expectValidationIssueFocus({
      address: "accessibility.level",
      initialDocument: invalidHeading,
      selection: "headline",
    })

    const invalidAction = cloneValue(EDITOR_TEMPLATES[0]!.document)
    const purchase = findNode(invalidAction, "purchase")
    if (!purchase || purchase.type !== "button" || purchase.action.type !== "purchase") {
      throw new Error("Missing purchase button")
    }
    purchase.action.productSelectorId = "missing-selector"
    await expectValidationIssueFocus({
      address: "action.productSelectorId",
      initialDocument: invalidAction,
      selection: "purchase",
    })

    const invalidFallback = cloneValue(EDITOR_TEMPLATES[0]!.document)
    const plans = findNode(invalidFallback, "plans")
    if (!plans || plans.type !== "productSelector") throw new Error("Missing product selector")
    ;(plans.unavailableFallback as unknown as { selection: string }).selection = "invalid"
    await expectValidationIssueFocus({
      address: "unavailableFallback.selection",
      initialDocument: invalidFallback,
      selection: "plans",
    })

    const invalidFeature = cloneValue(EDITOR_TEMPLATES[1]!.document)
    const features = findNode(invalidFeature, "features")
    if (!features || features.type !== "featureList" || !features.items[0]) {
      throw new Error("Missing feature list")
    }
    features.items[0].text.default = ""
    await expectValidationIssueFocus({
      address: `items.${features.items[0].id}.text`,
      initialDocument: invalidFeature,
      selection: "features",
    })
  })

  it.each([
    ["paywall-content", 0, "gap"],
    ["headline", 0, "value"],
    ["legal", 0, "typography.alignment"],
    ["features", 1, "gap"],
    ["plans", 0, "direction"],
    ["purchase", 0, "action.productSelectorId"],
    ["restore", 0, "action.type"],
    ["close", 0, "accessibility.label"],
  ] as const)(
    "renders a stable Protocol 0.2 field for %s",
    async (selection, templateIndex, address) => {
      render(
        <StudioWorkspaceStoreProvider storage={null}>
          <EditorStoreProvider>
            <InspectorHarness selection={selection} templateIndex={templateIndex} />
          </EditorStoreProvider>
        </StudioWorkspaceStoreProvider>,
      )
      await waitFor(() =>
        expect(
          document.getElementById(getInspectorFieldId(selection, address)),
        ).toBeInTheDocument(),
      )
    },
  )

  it("commits a multi-event numeric editing session as one undo step", async () => {
    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness selection="paywall-content" />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )
    const spacing = await screen.findByRole("spinbutton", { name: "Spacing" })
    expect(spacing).toHaveAttribute("min", "0")
    expect(spacing).toHaveAttribute("max", "4096")
    fireEvent.focus(spacing)
    fireEvent.change(spacing, { target: { value: "20" } })
    fireEvent.change(spacing, { target: { value: "22" } })
    fireEvent.change(spacing, { target: { value: "24" } })
    expect(screen.getByTestId("inspector-undo-count")).toHaveTextContent("0")
    fireEvent.blur(spacing)
    expect(screen.getByTestId("inspector-undo-count")).toHaveTextContent("1")
  })

  it("rejects numeric values outside the canonical schema range", async () => {
    renderInspector("headline")
    const fieldId = getInspectorFieldId("headline", "typography.fontSize")
    await waitFor(() => expect(document.getElementById(fieldId)).toBeInTheDocument())
    const fontSize = document.getElementById(fieldId) as HTMLInputElement
    const originalValue = fontSize.value

    expect(fontSize).toHaveAttribute("min", "8")
    expect(fontSize).toHaveAttribute("max", "96")
    fireEvent.focus(fontSize)
    fireEvent.change(fontSize, { target: { value: "7" } })
    fireEvent.blur(fontSize)

    await waitFor(() => expect(fontSize).toHaveValue(Number(originalValue)))
    expect(screen.getByTestId("inspector-undo-count")).toHaveTextContent("0")
  })

  it("cancels an unfinished localized text transaction without adding history", async () => {
    const textRender = renderInspector("headline")
    const headline = await screen.findByRole("textbox", { name: "Text" })
    const originalHeadline = (headline as HTMLInputElement).value
    fireEvent.focus(headline)
    fireEvent.change(headline, { target: { value: "Uncommitted headline" } })
    fireEvent.keyDown(headline, { key: "Escape" })
    expect(headline).toHaveValue(originalHeadline)
    expect(screen.getByTestId("inspector-undo-count")).toHaveTextContent("0")
    textRender.unmount()
  })

  it("renders exact inline validation and expands and focuses its stable property field", async () => {
    const issue: ValidationIssue = {
      code: "localization.emptyValue",
      componentId: "headline",
      documentPath: "/layout/content/children/1/value",
      message: "Visible text cannot be empty.",
      property: "value",
      recovery: "Enter text in the property inspector.",
      severity: "error",
    }
    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness issues={[issue]} selection="headline" />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )
    const field = await screen.findByRole("textbox", { name: "Text" })
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("alert")).toHaveTextContent("Visible text cannot be empty.")
    const section = field.closest("details")
    section?.removeAttribute("open")
    expect(focusInspectorValidationIssue(issue)).toBe(true)
    expect(section).toHaveAttribute("open")
    expect(field).toHaveFocus()
  })

  it("makes inherited layer locks read-only with an explicit recovery", async () => {
    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness lockSelection selection="headline" />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )
    expect(await screen.findByRole("textbox", { name: "Text" })).toBeDisabled()
    expect(screen.getByText("Properties are read-only")).toBeVisible()
    expect(screen.queryByText("headline")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Unlock Text" }))
    expect(screen.getByRole("textbox", { name: "Text" })).toBeEnabled()
  })

  it("names a locked ancestor without exposing its component ID", async () => {
    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness lockedLayerId="paywall-content" selection="headline" />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )
    expect(await screen.findByRole("textbox", { name: "Text" })).toBeDisabled()
    expect(screen.getByText("Ancestor Content Stack is locked.")).toBeVisible()
    expect(screen.queryByText("paywall-content")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Unlock Content Stack" }))
    expect(screen.getByRole("textbox", { name: "Text" })).toBeEnabled()
  })
})
