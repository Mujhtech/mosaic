import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { EditorStoreProvider } from "@/features/paywall-editor/stores/editor-store-context"
import { StudioWorkspaceStoreProvider } from "@/features/paywall-editor/stores/studio-workspace-store-context"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { appendScreen } from "@/features/paywall-editor/utils/document-tree"
import { getInspectorFieldId } from "@/features/paywall-editor/utils/property-inspector-navigation"
import {
  InspectorHarness,
  documentWithBlock,
  expectOnlySectionOpen,
  expectReadOnlyField,
  getInspectorSection,
  openInspectorSection,
  renderInspector,
  renderSeedMode,
  renderedPropertyAddresses,
  renderedSectionTitles,
} from "./property-inspector-test-support"

describe("property inspector safety", () => {
  it.each([
    ["paywall-scroll", 0, ["Layout", "Background", "Advanced"]],
    [
      "paywall-content",
      0,
      [
        "Layout",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Advanced",
      ],
    ],
    [
      "headline",
      0,
      [
        "Content",
        "Typography",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
    [
      "legal",
      0,
      [
        "Content",
        "Typography",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
    [
      "features",
      1,
      [
        "Content",
        "Typography",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
    [
      "plans",
      0,
      [
        "Product Cards",
        "Layout",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
    [
      "purchase",
      0,
      [
        "Content",
        "Actions",
        "Layout",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
    [
      "restore",
      0,
      [
        "Content",
        "Actions",
        "Layout",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
    [
      "close",
      0,
      [
        "Content",
        "Actions",
        "Layout",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
  ] as const)(
    "uses the frozen progressive section model for %s",
    async (selection, templateIndex, sections) => {
      const view = renderInspector(selection, templateIndex)
      await waitFor(() => expect(renderedSectionTitles()).toEqual([...sections]))
      view.unmount()
    },
  )

  it.each([
    [
      "image",
      [
        "Content",
        "Size",
        "Ratio",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
    [
      "carousel",
      [
        "Content",
        "Layout",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
    [
      "switch",
      [
        "Content",
        "Appearance",
        "Size",
        "Background",
        "Shadow",
        "Border",
        "Spacing",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
    [
      "countdown",
      [
        "Content",
        "Typography",
        "Size",
        "Spacing",
        "Background",
        "Shadow",
        "Border",
        "Appearance",
        "Visibility",
        "Accessibility",
        "Advanced",
      ],
    ],
  ] as const)("uses the frozen progressive section model for %s", async (type, sections) => {
    const fixture = documentWithBlock(type)
    const view = render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness initialDocument={fixture.document} selection={fixture.nodeId} />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )
    await waitFor(() => expect(renderedSectionTitles()).toEqual([...sections]))
    view.unmount()
  })

  it("refreshes a localized form value after undo on the same selection", () => {
    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness selection="headline" />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
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

  it.each([
    ["feature", "Add benefit"],
    ["hint", "Add accessibility hint"],
  ] as const)(
    "seeds every locale and stays valid when creating %s localized text",
    async (mode, action) => {
      renderSeedMode(mode)
      if (mode === "hint") {
        await waitFor(() => expect(getInspectorSection("Accessibility")).toBeInTheDocument())
        openInspectorSection("Accessibility")
      }
      fireEvent.click(await screen.findByRole("button", { name: action }))
      await waitFor(() =>
        expect(screen.getByTestId("all-locales-seeded")).toHaveTextContent("true"),
      )
      expect(screen.getByTestId("validation-count")).toHaveTextContent("0")
    },
  )

  it.each([
    [
      "paywall-content",
      0,
      [
        "direction",
        "gap",
        "padding.top",
        "crossAxisAlignment",
        "sizing.width",
        "appearance.background",
        "visibility.mode",
        "children",
        "id",
        "type",
      ],
    ],
    [
      "headline",
      0,
      [
        "value",
        "typography.style",
        "typography.color",
        "typography.lineHeightMultiplier",
        "typography.maxLines.enabled",
        "sizing.width",
        "appearance.background",
        "visibility.mode",
        "accessibility.role",
        "accessibility.level",
        "id",
        "type",
        "value.localizationKey",
      ],
    ],
    [
      "legal",
      0,
      [
        "value",
        "typography.alignment",
        "typography.color",
        "sizing.width",
        "appearance.background",
        "visibility.mode",
        "id",
        "type",
        "value.localizationKey",
      ],
    ],
    [
      "features",
      1,
      [
        "items.native-everywhere.text",
        "items.instant-preview.text",
        "gap",
        "markerColor",
        "typography.color",
        "sizing.width",
        "appearance.background",
        "visibility.mode",
        "accessibility.label",
        "id",
        "type",
        "marker",
        "items.native-everywhere.id",
        "items.native-everywhere.text.localizationKey",
        "items.instant-preview.id",
        "items.instant-preview.text.localizationKey",
        "accessibility.label.localizationKey",
      ],
    ],
    [
      "plans",
      0,
      [
        "direction",
        "crossAxisAlignment",
        "gap",
        "sizing.width",
        "appearance.background",
        "visibility.mode",
        "unavailableFallback.message",
        "accessibility.label",
        "accessibility.hint",
        "id",
        "type",
        "unavailableFallback.selection",
        "unavailableFallback.whenNoneAvailable",
        "unavailableFallback.message.localizationKey",
        "accessibility.label.localizationKey",
        "accessibility.hint.localizationKey",
      ],
    ],
    [
      "purchase",
      0,
      [
        "action.type",
        "action.productSelectorId",
        "direction",
        "gap",
        "sizing.width",
        "appearance.background",
        "visibility.mode",
        "accessibility.label",
        "id",
        "type",
        "children",
        "accessibility.label.localizationKey",
      ],
    ],
    [
      "restore",
      0,
      [
        "action.type",
        "direction",
        "gap",
        "sizing.width",
        "appearance.background",
        "visibility.mode",
        "accessibility.label",
        "id",
        "type",
        "children",
        "accessibility.label.localizationKey",
      ],
    ],
    [
      "close",
      0,
      [
        "action.type",
        "direction",
        "gap",
        "sizing.width",
        "appearance.background",
        "visibility.mode",
        "accessibility.label",
        "id",
        "type",
        "children",
        "accessibility.label.localizationKey",
      ],
    ],
  ] as const)(
    "renders contextual Protocol 0.2 property coverage for %s",
    async (selection, templateIndex, expectedAddresses) => {
      renderInspector(selection, templateIndex)
      await waitFor(() =>
        expect(document.getElementById(getInspectorFieldId(selection, "id"))).toBeInTheDocument(),
      )
      expect(renderedPropertyAddresses()).toEqual(expect.arrayContaining([...expectedAddresses]))
    },
  )

  it("seeds every locale and stays valid when an image becomes non-decorative", async () => {
    renderSeedMode("image")
    await waitFor(() => expect(getInspectorSection("Accessibility")).toBeInTheDocument())
    openInspectorSection("Accessibility")
    const decorative = await screen.findByRole("checkbox", {
      name: /Decorative; hide from assistive technology/i,
    })
    expect(decorative).toBeChecked()
    fireEvent.click(decorative)
    await waitFor(() => expect(screen.getByTestId("all-locales-seeded")).toHaveTextContent("true"))
    expect(screen.getByTestId("validation-count")).toHaveTextContent("0")
  })

  it.each([
    {
      advancedAddress: "type",
      advancedValue: "stack",
      primarySection: "Layout",
      selection: "paywall-content",
      templateIndex: 0,
    },
    {
      advancedAddress: "value.localizationKey",
      advancedValue: "paywall.headline",
      primarySection: "Content",
      selection: "headline",
      templateIndex: 0,
    },
    {
      advancedAddress: "value.localizationKey",
      advancedValue: "paywall.legal",
      primarySection: "Content",
      selection: "legal",
      templateIndex: 0,
    },
    {
      advancedAddress: "marker",
      advancedValue: "checkmark",
      primarySection: "Content",
      selection: "features",
      templateIndex: 1,
    },
    {
      advancedAddress: "unavailableFallback.selection",
      advancedValue: "firstAvailable",
      primarySection: "Product Cards",
      selection: "plans",
      templateIndex: 0,
    },
    {
      advancedAddress: "type",
      advancedValue: "button",
      primarySection: "Content",
      selection: "purchase",
      templateIndex: 0,
    },
    {
      advancedAddress: "type",
      advancedValue: "button",
      primarySection: "Content",
      selection: "restore",
      templateIndex: 0,
    },
    {
      advancedAddress: "type",
      advancedValue: "button",
      primarySection: "Content",
      selection: "close",
      templateIndex: 0,
    },
  ])(
    "progressively discloses Protocol 0.2 fields for $selection",
    async ({ advancedAddress, advancedValue, primarySection, selection, templateIndex }) => {
      renderInspector(selection, templateIndex)

      await waitFor(() => expect(getInspectorSection(primarySection)).toBeInTheDocument())
      expectOnlySectionOpen(primarySection)
      openInspectorSection("Advanced")
      expectReadOnlyField(selection, advancedAddress, advancedValue)
    },
  )

  it("inspects the immutable Scroll Container without exposing structural actions", async () => {
    renderInspector("paywall-scroll")

    const indicators = await screen.findByRole("checkbox", { name: "Show scroll indicators" })
    expect(indicators).toBeChecked()
    expectOnlySectionOpen("Layout")
    expect(renderedPropertyAddresses()).toEqual(
      expect.arrayContaining([
        "showsIndicators",
        "background",
        "id",
        "type",
        "axis",
        "safeArea",
        "content.id",
      ]),
    )

    openInspectorSection("Advanced")
    expectReadOnlyField("paywall-scroll", "axis", "vertical")
    expectReadOnlyField("paywall-scroll", "safeArea", "respect")
    expectReadOnlyField("paywall-scroll", "content.id", "paywall-content")

    fireEvent.click(indicators)
    expect(indicators).not.toBeChecked()
    expect(screen.getByTestId("inspector-undo-count")).toHaveTextContent("1")
  })

  it("sets an eligible Screen as the start destination", async () => {
    const appended = appendScreen(cloneValue(EDITOR_TEMPLATES[0]!.document))
    const addedScreen = appended.document.screens.find(
      (candidate) => candidate.id === appended.screenId,
    )
    if (!addedScreen) throw new Error("Missing appended screen")

    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <InspectorHarness initialDocument={appended.document} selection={addedScreen.layout.id} />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )

    fireEvent.click(await screen.findByRole("button", { name: "Set as start" }))
    await waitFor(() =>
      expect(screen.getByTestId("inspector-document")).toHaveTextContent(
        `"initialScreenId":"${appended.screenId}"`,
      ),
    )
    expect(screen.queryByRole("button", { name: "Set as start" })).not.toBeInTheDocument()
  })
})
