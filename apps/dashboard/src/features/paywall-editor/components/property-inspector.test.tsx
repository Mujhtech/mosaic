import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useEffect } from "react"
import { describe, expect, it } from "vitest"

import { PropertyInspector } from "@/features/paywall-editor/components/property-inspector"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  collectEditorValidation,
  useEditorValidation,
} from "@/features/paywall-editor/hooks/use-editor-validation"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import { StudioWorkspaceStoreProvider } from "@/features/paywall-editor/stores/studio-workspace-store-context"
import { useStudioWorkspaceActions } from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  InsertableBlockType,
  MosaicDocument,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import {
  appendScreen,
  findNode,
  insertBlockAtLocation,
} from "@/features/paywall-editor/utils/document-tree"
import {
  focusInspectorValidationIssue,
  getInspectorFieldId,
} from "@/features/paywall-editor/utils/property-inspector-navigation"

function InspectorHarness({
  initialDocument,
  issues = [],
  lockedLayerId,
  lockSelection = false,
  selection = "plans",
  templateIndex = 0,
}: {
  initialDocument?: MosaicDocument
  issues?: readonly ValidationIssue[]
  lockedLayerId?: string
  lockSelection?: boolean
  selection?: string
  templateIndex?: number
}) {
  const { document, productLayerPreview, selectedComponentId, undoStack } = useEditorStore()
  const { loadTemplate, selectComponent, undo } = useEditorActions()
  const workspace = useStudioWorkspaceActions()

  useEffect(() => {
    if (!document) loadTemplate(initialDocument ?? EDITOR_TEMPLATES[templateIndex]!.document)
    else {
      if (selectedComponentId !== selection) selectComponent(selection)
      const layerToLock = lockedLayerId ?? (lockSelection ? selection : null)
      if (layerToLock) workspace.setLayerLocked(layerToLock, true)
    }
  }, [
    document,
    initialDocument,
    loadTemplate,
    lockedLayerId,
    lockSelection,
    selectComponent,
    selectedComponentId,
    selection,
    templateIndex,
    workspace,
  ])

  const selector = document ? findNode(document, "plans") : null
  const firstCard = selector?.type === "productSelector" ? selector.cards[0] : null
  return (
    <>
      <PropertyInspector issues={issues} />
      <button type="button" onClick={undo}>
        Undo editor change
      </button>
      <output data-testid="bindings">
        {selector?.type === "productSelector"
          ? selector.cards.map((card) => card.productReferenceId).join(",")
          : ""}
      </output>
      <output data-testid="selected-card-style">
        {firstCard ? JSON.stringify(firstCard.styles.selected) : ""}
      </output>
      <output data-testid="inspector-undo-count">{undoStack.length}</output>
      <output data-testid="product-layer-preview">
        {productLayerPreview
          ? `${productLayerPreview.nodeId}:${productLayerPreview.state}`
          : "none"}
      </output>
      <output data-testid="inspector-document">{document ? JSON.stringify(document) : ""}</output>
    </>
  )
}

type SeedMode = "feature" | "hint" | "image"

function SeededLocalizedTextHarness({ mode }: { mode: SeedMode }) {
  const { document, selectedComponentId } = useEditorStore()
  const editor = useEditorActions()
  const validation = useEditorValidation()

  useEffect(() => {
    if (!document) {
      editor.loadTemplate(EDITOR_TEMPLATES[mode === "feature" ? 1 : 0]!.document)
      return
    }
    if (mode === "image") {
      const image = findNode(document, "image-1")
      if (!image) {
        const result = editor.insertComponentAt("image", {
          parentId: document.screens[0]!.layout.content.id,
          index: 0,
        })
        if (result.status === "accepted") editor.selectComponent(result.nodeId)
        return
      }
      if (selectedComponentId !== image.id) editor.selectComponent(image.id)
      return
    }
    const selection = mode === "feature" ? "features" : "purchase"
    if (selectedComponentId !== selection) editor.selectComponent(selection)
  }, [document, editor, mode, selectedComponentId])

  const selected = document ? findNode(document, selectedComponentId) : null
  const createdText =
    mode === "feature" && selected?.type === "featureList" && selected.items.length > 2
      ? selected.items.at(-1)?.text
      : mode === "hint" && selected?.type === "button"
        ? selected.accessibility.hint
        : mode === "image" && selected?.type === "image" && !selected.accessibility.hidden
          ? selected.accessibility.label
          : undefined
  const seeded =
    createdText && document
      ? Object.values(document.localization.locales).every((catalog) =>
          catalog.strings[createdText.localizationKey]?.trim(),
        )
      : false

  return (
    <>
      <PropertyInspector issues={validation.issues} />
      <output data-testid="validation-count">{validation.errors.length}</output>
      <output data-testid="all-locales-seeded">{String(seeded)}</output>
    </>
  )
}

function renderSeedMode(mode: SeedMode) {
  return render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <SeededLocalizedTextHarness mode={mode} />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )
}

function renderInspector(selection: string, templateIndex = 0) {
  return render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InspectorHarness selection={selection} templateIndex={templateIndex} />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )
}

function documentWithBlock(type: InsertableBlockType) {
  const document = cloneValue(EDITOR_TEMPLATES[0]!.document)
  const result = insertBlockAtLocation(
    document,
    type,
    {
      parentId: document.screens[0]!.layout.content.id,
      index: document.screens[0]!.layout.content.children.length,
    },
    type === "countdown" ? { countdownEndsAt: "2030-12-31T23:59:59Z" } : undefined,
  )
  if (result.status === "rejected") throw new Error(result.message)
  return { document: result.document, nodeId: result.nodeId }
}

function getInspectorSection(title: string) {
  const section = document.querySelector(`[data-inspector-section="${title}"]`)
  if (!(section instanceof HTMLDetailsElement)) {
    throw new Error(`Missing ${title} inspector section`)
  }
  return section
}

function openInspectorSection(title: string) {
  const section = getInspectorSection(title)
  if (!section.open) {
    const summary = section.querySelector("summary")
    if (!(summary instanceof HTMLElement)) throw new Error(`Missing ${title} section summary`)
    fireEvent.click(summary)
  }
  return section
}

function expectReadOnlyField(componentId: string, address: string, value: string) {
  const field = document.getElementById(getInspectorFieldId(componentId, address))
  expect(field).toBeInstanceOf(HTMLInputElement)
  expect(field).toHaveAttribute("readonly")
  expect(field).toHaveValue(value)
}

function expectOnlySectionOpen(title: string) {
  const sections = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("[data-inspector-section]"),
  )
  expect(sections.length).toBeGreaterThan(1)
  for (const section of sections) {
    expect(section.open).toBe(section.dataset.inspectorSection === title)
  }
  expect(getInspectorSection("Advanced")).not.toHaveAttribute("open")
}

function renderedPropertyAddresses() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-property-address]"))
    .map((element) => element.dataset.propertyAddress)
    .filter((address): address is string => Boolean(address))
}

function renderedSectionTitles() {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>("[data-inspector-section]")).map(
    (section) => section.dataset.inspectorSection,
  )
}

async function expectValidationIssueFocus({
  address,
  initialDocument,
  selection,
}: {
  address: string
  initialDocument: MosaicDocument
  selection: string
}) {
  const issue = collectEditorValidation(initialDocument).issues.find(
    (candidate) => candidate.componentId === selection && candidate.property === address,
  )
  if (!issue) throw new Error(`Missing ${selection}.${address} validation issue`)

  const view = render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InspectorHarness
          initialDocument={initialDocument}
          issues={[issue]}
          selection={selection}
        />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )
  const fieldId = getInspectorFieldId(selection, address)
  await waitFor(() => expect(document.getElementById(fieldId)).toBeInTheDocument())
  const field = document.getElementById(fieldId)
  if (!(field instanceof HTMLElement)) throw new Error(`Missing ${fieldId}`)
  const section = field.closest("details")
  section?.removeAttribute("open")

  expect(focusInspectorValidationIssue(issue)).toBe(true)
  expect(section).toHaveAttribute("open")
  expect(field).toHaveFocus()
  view.unmount()
}

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
