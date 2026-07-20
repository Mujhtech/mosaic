/* eslint-disable react-refresh/only-export-components -- test-only harness exports fixtures and render helpers alongside harness components. */
import { fireEvent, render, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { expect } from "vitest"

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
import {
  StudioWorkspaceStoreProvider,
  useStudioWorkspaceActions,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type {
  InsertableBlockType,
  MosaicDocument,
  ValidationIssue,
} from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode, insertBlockAtLocation } from "@/features/paywall-editor/utils/document-tree"
import {
  focusInspectorValidationIssue,
  getInspectorFieldId,
} from "@/features/paywall-editor/utils/property-inspector-navigation"

export function InspectorHarness({
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

export type SeedMode = "feature" | "hint" | "image"

export function SeededLocalizedTextHarness({ mode }: { mode: SeedMode }) {
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

export function renderSeedMode(mode: SeedMode) {
  return render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <SeededLocalizedTextHarness mode={mode} />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )
}

export function renderInspector(selection: string, templateIndex = 0) {
  return render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InspectorHarness selection={selection} templateIndex={templateIndex} />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )
}

export function documentWithBlock(type: InsertableBlockType) {
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

export function getInspectorSection(title: string) {
  const section = document.querySelector(`[data-inspector-section="${title}"]`)
  if (!(section instanceof HTMLDetailsElement)) {
    throw new Error(`Missing ${title} inspector section`)
  }
  return section
}

export function openInspectorSection(title: string) {
  const section = getInspectorSection(title)
  if (!section.open) {
    const summary = section.querySelector("summary")
    if (!(summary instanceof HTMLElement)) throw new Error(`Missing ${title} section summary`)
    fireEvent.click(summary)
  }
  return section
}

export function expectReadOnlyField(componentId: string, address: string, value: string) {
  const field = document.getElementById(getInspectorFieldId(componentId, address))
  expect(field).toBeInstanceOf(HTMLInputElement)
  expect(field).toHaveAttribute("readonly")
  expect(field).toHaveValue(value)
}

export function expectOnlySectionOpen(title: string) {
  const sections = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("[data-inspector-section]"),
  )
  expect(sections.length).toBeGreaterThan(1)
  for (const section of sections) {
    expect(section.open).toBe(section.dataset.inspectorSection === title)
  }
  expect(getInspectorSection("Advanced")).not.toHaveAttribute("open")
}

export function renderedPropertyAddresses() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-property-address]"))
    .map((element) => element.dataset.propertyAddress)
    .filter((address): address is string => Boolean(address))
}

export function renderedSectionTitles() {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>("[data-inspector-section]")).map(
    (section) => section.dataset.inspectorSection,
  )
}

export async function expectValidationIssueFocus({
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
