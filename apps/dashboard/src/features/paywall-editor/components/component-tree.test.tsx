import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useLayoutEffect } from "react"
import { describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import {
  COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE,
  COMPONENT_LIBRARY_DRAG_TYPE,
} from "@/features/paywall-editor/components/component-catalog"
import { ComponentLibrary } from "@/features/paywall-editor/components/component-library"
import { ComponentTree } from "@/features/paywall-editor/components/component-tree"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import { serializeDocument } from "@/features/paywall-editor/mutations/local-project-file"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import {
  StudioWorkspaceStoreProvider,
  useStudioWorkspaceActions,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type { PreviewClient } from "@/features/paywall-editor/types/editor"
import { cloneValue } from "@/features/paywall-editor/utils/clone"
import { findNode, flattenDocument } from "@/features/paywall-editor/utils/document-tree"

const selectWorkspaceProbe = (snapshot: StudioWorkspaceSnapshot) => ({
  hiddenIds: snapshot.preferences.layerMetadata.canvasHiddenIds,
  labels: snapshot.preferences.layerMetadata.labels,
  lockedIds: snapshot.preferences.layerMetadata.lockedIds,
  recentInsertions: snapshot.preferences.recentInsertions,
})

function InitializeTree({ invalidHeadline }: { invalidHeadline: boolean }) {
  const editor = useEditorActions()
  const workspace = useStudioWorkspaceActions()

  useLayoutEffect(() => {
    if (editor.getSnapshot().document) return
    const template = EDITOR_TEMPLATES[0]!
    const document = cloneValue(template.document)
    if (invalidHeadline) {
      const headline = findNode(document, "headline")
      if (headline?.type !== "text") throw new Error("Missing headline fixture")
      headline.value.default = ""
      document.localization.locales.en!.strings[headline.value.localizationKey] = ""
    }
    editor.loadTemplate(document)
    const stack = editor.insertComponentAt("stack", {
      parentId: template.document.screens[0]!.layout.content.id,
      index: 2,
    })
    if (stack.status !== "accepted") throw new Error(stack.message)
    editor.moveComponent("subtitle", {
      placement: "inside",
      targetId: stack.nodeId,
      index: 0,
    })
    const nested = findNode(editor.getSnapshot().document!, stack.nodeId)
    if (nested?.type !== "stack") throw new Error("Missing nested Stack fixture")
    workspace.setLayerLabel("headline", "Hero headline")
    workspace.setLayerLabel("legal", "Terms")
    workspace.setLayerLabel(stack.nodeId, "Offer group")
    workspace.setLayerLabel(nested.children[0]!.id, "Nested copy")
    editor.selectComponent("headline")
  }, [editor, invalidHeadline, workspace])

  return null
}

function TreeProbe({ serializePortable }: { serializePortable: boolean }) {
  const editor = useEditorActions()
  const { document, hoveredComponentId, selectedComponentId, undoStack } = useEditorStore()
  const workspace = useStudioWorkspaceSelector(selectWorkspaceProbe)
  const entries = document ? flattenDocument(document) : []
  const nestedCopy = entries.find((entry) => workspace.labels[entry.node.id] === "Nested copy")
    ?.node.id

  return (
    <div>
      <button type="button" onClick={() => editor.selectComponent(nestedCopy ?? null)}>
        Select nested copy
      </button>
      <output data-testid="document-nodes">
        {entries.map((entry) => `${entry.node.id}:${entry.node.type}`).join("|")}
      </output>
      <output data-testid="document-revision">{document?.revision ?? "none"}</output>
      <output data-testid="screen-presentations">
        {document?.screens
          .map(
            (paywallScreen) =>
              `${paywallScreen.id}:${(paywallScreen as typeof paywallScreen & { presentation?: { type: string } }).presentation?.type ?? "screen"}`,
          )
          .join("|") ?? "none"}
      </output>
      <output data-testid="portable-document">
        {document ? (serializePortable ? serializeDocument(document) : "invalid") : "none"}
      </output>
      <output data-testid="tree-layout">
        {entries
          .map((entry) => `${entry.node.id}@${entry.parentId ?? "root"}:${entry.index}`)
          .join("|")}
      </output>
      <output data-testid="tree-collections">
        {entries
          .map(
            (entry) =>
              `${entry.node.id}@${entry.parentId ?? "root"}:${entry.collection}:${entry.index}`,
          )
          .join("|")}
      </output>
      <output data-testid="hidden-ids">{workspace.hiddenIds.join("|")}</output>
      <output data-testid="hovered-id">{hoveredComponentId ?? "none"}</output>
      <output data-testid="locked-ids">{workspace.lockedIds.join("|")}</output>
      <output data-testid="recent-insertions">{workspace.recentInsertions.join("|")}</output>
      <output data-testid="selected-id">{selectedComponentId ?? "none"}</output>
      <output data-testid="undo-count">{undoStack.length}</output>
    </div>
  )
}

function renderTree({
  includeLibrary = false,
  invalidHeadline = false,
  previewClients = [],
}: {
  includeLibrary?: boolean
  invalidHeadline?: boolean
  previewClients?: readonly PreviewClient[]
} = {}) {
  render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <TooltipProvider>
          <InitializeTree invalidHeadline={invalidHeadline} />
          {includeLibrary ? <ComponentLibrary /> : null}
          <ComponentTree previewClients={previewClients} />
          <TreeProbe serializePortable={!invalidHeadline} />
        </TooltipProvider>
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )
}

function previewClient(
  platform: PreviewClient["platform"],
  unsupportedCapability?: string,
): PreviewClient {
  const document = EDITOR_TEMPLATES[0]!.document
  return {
    clientId: `client-${platform}`,
    sessionId: "session-local",
    platform,
    displayName: `${platform} preview`,
    renderer: { id: `mosaic-${platform}`, version: "0.1" },
    application: { id: `example-${platform}`, displayName: "Mosaic Example", version: "0.1" },
    device: { displayName: `${platform} device`, systemName: platform, systemVersion: "1" },
    supportedSchemaVersions: [document.schemaVersion],
    supportedCapabilities: document.compatibility.requiredCapabilities.filter(
      (capability) => capability.name !== unsupportedCapability,
    ),
    previewCapabilities: [],
    lastSeenAt: "2026-07-17T00:00:00.000Z",
  }
}

function createDataTransfer() {
  const values = new Map<string, string>()
  let payloadProtected = false
  return {
    transfer: {
      dropEffect: "none",
      effectAllowed: "uninitialized",
      getData: (type: string) => (payloadProtected ? "" : (values.get(type) ?? "")),
      setData: (type: string, value: string) => values.set(type, value),
      get types() {
        return [...values.keys()]
      },
    } as unknown as DataTransfer,
    protect: () => {
      payloadProtected = true
    },
    reveal: () => {
      payloadProtected = false
    },
  }
}

function setRowBounds(element: HTMLElement, height = 40) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ height, top: 0 }) as DOMRect,
  })
}

function fireRowDragEvent(
  type: "dragOver" | "drop",
  element: HTMLElement,
  dataTransfer: DataTransfer,
  clientY: number,
) {
  const event = createEvent[type](element, { dataTransfer })
  Object.defineProperty(event, "clientY", { configurable: true, value: clientY })
  fireEvent(element, event)
}

function fireRowPointerEvent(
  type: "pointerDown" | "pointerMove" | "pointerUp",
  element: HTMLElement,
  point: { clientX: number; clientY: number; pointerId?: number },
) {
  const event = createEvent[type](element, { button: 0 })
  Object.entries({ pointerId: point.pointerId ?? 1, ...point }).forEach(([key, value]) => {
    Object.defineProperty(event, key, { configurable: true, value })
  })
  fireEvent(element, event)
}

describe("ComponentTree", () => {
  it("adds a second screen from Layers and selects its editable starter content", async () => {
    renderTree()
    const addDestination = await screen.findByRole("button", { name: "Add screen or sheet" })
    const baselineUndo = Number(screen.getByTestId("undo-count").textContent)

    fireEvent.click(addDestination)
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add screen" }))

    expect(await screen.findByTitle("Screen · screen-2")).toHaveAttribute("aria-level", "1")
    expect(document.querySelector('[data-layer-row-id="screen-2-title"]')).toHaveAttribute(
      "aria-level",
      "3",
    )
    expect(screen.getByTestId("selected-id")).toHaveTextContent("screen-2-title")
    expect(screen.getByTestId("document-nodes")).toHaveTextContent("screen-2-title:text")
    expect(screen.getByTestId("undo-count")).toHaveTextContent(String(baselineUndo + 1))
    expect(screen.getByText("Screen added")).toBeVisible()
  })

  it("adds a sheet from the focused screen without replacing the existing screen", async () => {
    renderTree()
    const baselineUndo = Number(screen.getByTestId("undo-count").textContent)

    fireEvent.click(await screen.findByRole("button", { name: "Add screen or sheet" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add sheet" }))

    expect(await screen.findByTitle("Sheet · screen-2")).toBeVisible()
    expect(screen.getByTestId("screen-presentations")).toHaveTextContent(
      "main:screen|screen-2:sheet",
    )
    expect(screen.getByTestId("document-nodes")).toHaveTextContent("screen-2-title:text")
    expect(screen.getByTestId("undo-count")).toHaveTextContent(String(baselineUndo + 1))
    expect(screen.getByText("Sheet added")).toBeVisible()
  })

  it("keeps valid layers quiet and reserves status icons for exceptions", async () => {
    renderTree({ previewClients: [previewClient("ios"), previewClient("android")] })
    const headline = await screen.findByTitle("Hero headline")

    expect(headline.querySelector('[data-slot="layer-status"]')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/capability declared/i)).not.toBeInTheDocument()
  })

  it("uses an error icon when a layer is invalid", async () => {
    renderTree({ invalidHeadline: true })
    const headline = await screen.findByTitle("Hero headline")

    expect(within(headline).getByLabelText(/validation errors?/)).toHaveAttribute(
      "data-slot",
      "layer-status",
    )
  })

  it("shows compatibility only where connected platform support differs", async () => {
    renderTree({
      previewClients: [previewClient("ios"), previewClient("android", "component.text")],
    })
    const headline = await screen.findByTitle("Hero headline")

    expect(
      within(headline).getByLabelText("component.text support differs on 1 connected preview"),
    ).toHaveAttribute("data-slot", "layer-status")
    expect(
      screen.getByTitle("Product Selector").querySelector('[data-slot="layer-status"]'),
    ).not.toBeInTheDocument()
  })

  it("renders the Scroll root and nested content as an accessible, revealable ARIA tree", async () => {
    renderTree()
    await waitFor(() => expect(screen.getByTitle("Hero headline")).toBeVisible())

    const tree = screen.getByRole("tree", { name: "Paywall component tree" })
    const items = screen.getAllByRole("treeitem")
    expect(tree).toBeVisible()
    expect(items[0]).toHaveAttribute("aria-level", "1")
    expect(items[0]).not.toHaveAttribute("aria-disabled")
    expect(items[1]).toHaveAttribute("aria-level", "2")
    expect(screen.getByTitle("Offer group")).toHaveAttribute("aria-level", "3")
    expect(screen.getByTitle("Nested copy")).toHaveAttribute("aria-level", "4")
    expect(screen.getByTitle("Hero headline")).toHaveAttribute("draggable", "true")
    expect(screen.getByTitle("Drag Hero headline to reorder")).toHaveAttribute(
      "data-slot",
      "layer-reorder-affordance",
    )
    expect(screen.getByText("Drag anywhere on a layer row to reorder.")).toBeVisible()
    expect(
      screen.queryByRole("toolbar", { name: "Selected layer actions" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Move selected layer/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Arrow keys navigate/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Layer shortcuts" })).toHaveAttribute(
      "title",
      "Layer shortcuts",
    )

    fireEvent.click(items[0]!)
    expect(items[0]).toHaveAttribute("aria-selected", "true")
    expect(screen.getByTestId("selected-id")).toHaveTextContent("paywall-scroll")

    fireEvent.click(screen.getByRole("button", { name: "Collapse Offer group" }))
    expect(screen.queryByTitle("Nested copy")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Select nested copy" }))

    await waitFor(() => expect(screen.getByTitle("Nested copy")).toBeVisible())
    expect(screen.getByTestId("selected-id")).not.toHaveTextContent("headline")
  })

  it("exposes Button in-progress children as selectable structural layers", async () => {
    renderTree()
    const purchase = await screen.findByTitle("Purchase")
    fireEvent.click(within(purchase).getByRole("button", { name: "Expand Purchase" }))

    const progress = await screen.findByTitle("In progress · Text")
    expect(progress).toHaveAttribute("data-layer-row-id", "purchase-progress")
    fireEvent.click(progress)
    expect(screen.getByTestId("selected-id")).toHaveTextContent("purchase-progress")

    fireEvent.keyDown(progress, { key: "d", metaKey: true })
    await waitFor(() =>
      expect(screen.getByTestId("tree-collections")).toHaveTextContent(
        /purchase-progress@purchase:inProgressChildren:0.*purchase-progress-copy@purchase:inProgressChildren:1/,
      ),
    )
  })

  it("uses authored Product Cards and Badges as reorderable structural layers", async () => {
    renderTree()
    const selector = await screen.findByTitle("Product Selector")
    fireEvent.click(within(selector).getByRole("button", { name: "Expand Product Selector" }))

    await waitFor(() =>
      expect(document.querySelector('[data-layer-row-id="monthly-card"]')).toBeVisible(),
    )
    const monthly = document.querySelector<HTMLElement>('[data-layer-row-id="monthly-card"]')
    const yearly = document.querySelector<HTMLElement>('[data-layer-row-id="yearly-card"]')
    expect(monthly).toHaveAttribute("aria-level", "4")
    expect(yearly).toHaveAttribute("aria-level", "4")
    if (!monthly || !yearly) throw new Error("Missing authored Product Card layers")

    fireEvent.click(within(yearly).getByRole("button", { name: "Expand Product Card" }))
    expect(document.querySelector('[data-layer-row-id="yearly-badge"]')).toHaveAttribute(
      "aria-level",
      "5",
    )

    const baselineUndo = Number(screen.getByTestId("undo-count").textContent)
    const transfer = createDataTransfer()
    fireEvent.dragStart(monthly, { dataTransfer: transfer.transfer })
    setRowBounds(yearly)
    fireRowDragEvent("dragOver", yearly, transfer.transfer, 39)
    expect(yearly).toHaveAttribute("data-drop-placement", "after")
    fireRowDragEvent("drop", yearly, transfer.transfer, 39)

    await waitFor(() =>
      expect(screen.getByTestId("tree-collections")).toHaveTextContent(
        /yearly-card@plans:cards:0.*monthly-card@plans:cards:1/,
      ),
    )
    expect(screen.getByTestId("undo-count")).toHaveTextContent(String(baselineUndo + 1))
  })

  it("keeps keyboard guidance in the shortcuts tooltip instead of permanent panel copy", async () => {
    renderTree()
    const shortcuts = await screen.findByRole("button", { name: "Layer shortcuts" })

    expect(screen.queryByText("Nest or outdent")).not.toBeInTheDocument()
    shortcuts.focus()
    fireEvent.focus(shortcuts)

    expect(await screen.findByText("Nest or outdent")).toBeVisible()
    expect(screen.getByText("Duplicate")).toBeVisible()
    expect(screen.getByText("Delete layer")).toBeVisible()
  })

  it("keeps hover synchronized and keyboard delete scoped to the focused row", async () => {
    renderTree()
    await waitFor(() => expect(screen.getByTitle("Terms")).toBeVisible())
    const terms = screen.getByTitle("Terms")

    fireEvent.mouseEnter(screen.getByTitle("Hero headline"))
    expect(screen.getByTestId("hovered-id")).toHaveTextContent("headline")
    fireEvent.mouseLeave(screen.getByTitle("Hero headline"))
    expect(screen.getByTestId("hovered-id")).toHaveTextContent("none")

    terms.focus()
    fireEvent.keyDown(terms, { key: "Delete" })

    await waitFor(() => expect(screen.queryByTitle("Terms")).not.toBeInTheDocument())
    expect(screen.getByTestId("document-nodes")).toHaveTextContent("headline:text")
    expect(screen.getByTestId("document-nodes")).not.toHaveTextContent("legal:text")
  })

  it("duplicates the focused row rather than a different selected layer", async () => {
    renderTree()
    await waitFor(() => expect(screen.getByTitle("Terms")).toBeVisible())
    const terms = screen.getByTitle("Terms")

    terms.focus()
    fireEvent.keyDown(terms, { ctrlKey: true, key: "d" })

    await waitFor(() => {
      const nodes = screen.getByTestId("document-nodes").textContent ?? ""
      expect(nodes.match(/legal(?:-copy(?:-\d+)?)?:text/g)).toHaveLength(2)
      expect(nodes.match(/headline:text/g)).toHaveLength(1)
    })
  })

  it("keeps duplicate and delete contextual while showing nest controls only when valid", async () => {
    renderTree()
    await screen.findByTitle("Hero headline")

    fireEvent.click(screen.getByRole("button", { name: "Actions for Hero headline" }))
    expect(await screen.findByRole("menuitem", { name: "Duplicate" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeVisible()
    expect(screen.queryByRole("menuitem", { name: "Indent" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Outdent" })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "Actions for Product Selector" }))
    expect(await screen.findByRole("menuitem", { name: "Indent" })).toBeVisible()
    expect(screen.queryByRole("menuitem", { name: "Outdent" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitem", { name: "Indent" }))
    expect(await screen.findByText("Layer indented")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Actions for Product Selector" }))
    expect(await screen.findByRole("menuitem", { name: "Outdent" })).toBeVisible()
    expect(screen.queryByRole("menuitem", { name: "Indent" })).not.toBeInTheDocument()
  })

  it("opens the same layer actions from a native right click", async () => {
    renderTree()
    const headline = await screen.findByTitle("Hero headline")

    fireEvent.click(screen.getByRole("button", { name: "Actions for Hero headline" }))
    const overflowActions = (await screen.findAllByRole("menuitem")).map((item) =>
      item.textContent?.trim(),
    )
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())

    fireEvent.contextMenu(headline, { clientX: 120, clientY: 80 })
    const contextActions = (await screen.findAllByRole("menuitem")).map((item) =>
      item.textContent?.trim(),
    )

    expect(contextActions).toEqual(overflowActions)
    expect(screen.getByTestId("selected-id")).toHaveTextContent("headline")
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename layer" }))
    const rename = await screen.findByRole("textbox", { name: "Rename Hero headline" })
    expect(rename).toHaveFocus()
    fireEvent.keyDown(rename, { key: "Escape" })
  })

  it("keeps rename, lock, and hide as workspace-only metadata", async () => {
    renderTree()
    await waitFor(() => expect(screen.getByTitle("Hero headline")).toBeVisible())
    const baselineRevision = screen.getByTestId("document-revision").textContent
    const baselineUndo = screen.getByTestId("undo-count").textContent
    const baselinePortable = screen.getByTestId("portable-document").textContent

    fireEvent.click(screen.getByRole("button", { name: "Actions for Hero headline" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename layer" }))
    const rename = await screen.findByRole("textbox", { name: "Rename Hero headline" })
    expect(rename).toHaveFocus()
    fireEvent.change(rename, { target: { value: "Primary headline" } })
    fireEvent.keyDown(rename, { key: "Enter" })
    expect(screen.getByTitle("Primary headline")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Actions for Primary headline" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Lock canvas layer" }))
    await waitFor(() => expect(screen.getByTestId("locked-ids")).toHaveTextContent("headline"))

    fireEvent.click(screen.getByRole("button", { name: "Actions for Primary headline" }))
    expect(await screen.findByRole("menuitem", { name: "Duplicate" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    expect(screen.queryByRole("menuitem", { name: "Indent" })).not.toBeInTheDocument()
    expect(screen.queryByRole("menuitem", { name: "Outdent" })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Hide on canvas" }))
    await waitFor(() => expect(screen.getByTestId("hidden-ids")).toHaveTextContent("headline"))
    expect(screen.getByTestId("document-revision")).toHaveTextContent(baselineRevision ?? "")
    expect(screen.getByTestId("undo-count")).toHaveTextContent(baselineUndo ?? "")
    expect(screen.getByTestId("portable-document").textContent).toBe(baselinePortable)
    expect(screen.getByTestId("portable-document")).not.toHaveTextContent("Primary headline")
    expect(screen.getByTestId("portable-document")).not.toHaveTextContent("layerMetadata")
    expect(screen.getByTestId("portable-document")).not.toHaveTextContent("lockedIds")
    expect(screen.getByTestId("portable-document")).not.toHaveTextContent("canvasHiddenIds")
  })

  it("shows the store rejection reason and recovery for an invalid native tree drop", async () => {
    renderTree()
    await waitFor(() => expect(screen.getByTitle("Offer group")).toBeVisible())
    const transfer = createDataTransfer()

    const offerGroup = screen.getByTitle("Offer group")
    setRowBounds(offerGroup)
    fireEvent.dragStart(within(offerGroup).getByText("Offer group"), {
      dataTransfer: transfer.transfer,
    })
    fireRowDragEvent("dragOver", offerGroup, transfer.transfer, 20)
    expect(offerGroup).toHaveAttribute("data-drop-placement", "inside")
    fireRowDragEvent("drop", offerGroup, transfer.transfer, 20)

    expect(
      screen.getByText("A component cannot be moved relative to or inside itself."),
    ).toBeVisible()
    expect(screen.getByText("Choose a different component or Stack as the target.")).toBeVisible()
  })

  it.each([
    {
      placement: "before",
      source: "Restore",
      target: "Purchase",
      clientY: 1,
      expected: /restore@paywall-content:4.*purchase@paywall-content:5/,
    },
    {
      placement: "inside",
      source: "Restore",
      target: "Offer group",
      clientY: 20,
      expected: /restore@stack(?:-\d+)?:1/,
    },
    {
      placement: "after",
      source: "Product Selector",
      target: "Restore",
      clientY: 39,
      expected: /restore@paywall-content:4.*plans@paywall-content:5/,
    },
  ])("applies a native row $placement drop as exactly one history edit", async (scenario) => {
    renderTree()
    await waitFor(() => expect(screen.getByTitle(scenario.source)).toBeVisible())
    const baselineUndo = Number(screen.getByTestId("undo-count").textContent)
    const transfer = createDataTransfer()

    const sourceRow = screen.getByTitle(scenario.source)
    fireEvent.dragStart(within(sourceRow).getByText(scenario.source), {
      dataTransfer: transfer.transfer,
    })
    const targetRow = screen.getByTitle(scenario.target)
    setRowBounds(targetRow)
    fireRowDragEvent("dragOver", targetRow, transfer.transfer, scenario.clientY)
    expect(targetRow).toHaveAttribute("data-drop-placement", scenario.placement)
    fireRowDragEvent("drop", targetRow, transfer.transfer, scenario.clientY)

    await waitFor(() =>
      expect(screen.getByTestId("tree-layout")).toHaveTextContent(scenario.expected),
    )
    expect(screen.getByTestId("undo-count")).toHaveTextContent(String(baselineUndo + 1))
    expect(screen.getByText("Layer moved")).toBeVisible()
  })

  it("reorders by pointer from the label area without requiring the grip", async () => {
    renderTree()
    await waitFor(() => expect(screen.getByTitle("Restore")).toBeVisible())
    const baselineUndo = Number(screen.getByTestId("undo-count").textContent)
    const restore = screen.getByTitle("Restore")
    const purchase = screen.getByTitle("Purchase")
    setRowBounds(purchase)
    const originalElementFromPoint = globalThis.document.elementFromPoint

    Object.defineProperty(globalThis.document, "elementFromPoint", {
      configurable: true,
      value: () => purchase,
    })
    try {
      fireRowPointerEvent("pointerDown", within(restore).getByText("Restore"), {
        clientX: 100,
        clientY: 100,
      })
      fireRowPointerEvent("pointerMove", restore, { clientX: 100, clientY: 1 })
      fireRowPointerEvent("pointerUp", restore, { clientX: 100, clientY: 1 })
    } finally {
      Object.defineProperty(globalThis.document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint,
      })
    }

    await waitFor(() =>
      expect(screen.getByTestId("tree-layout")).toHaveTextContent(
        /restore@paywall-content:4.*purchase@paywall-content:5/,
      ),
    )
    expect(screen.getByTestId("undo-count")).toHaveTextContent(String(baselineUndo + 1))
    expect(screen.getByText("Layer moved")).toBeVisible()
  })

  it("accepts a MIME-only generic Button payload on drop", async () => {
    renderTree({ includeLibrary: true })
    await waitFor(() => expect(screen.getByTitle("Content Stack")).toBeVisible())
    const transfer = createDataTransfer()
    fireEvent.dragStart(screen.getByRole("button", { name: /^Button\b/i }), {
      dataTransfer: transfer.transfer,
    })
    expect(transfer.transfer.getData(COMPONENT_LIBRARY_DRAG_TYPE)).toBe("button")

    transfer.protect()
    fireEvent.dragOver(screen.getByTitle("Content Stack"), { dataTransfer: transfer.transfer })
    expect(screen.getByText("Drop inside Content Stack")).toBeVisible()

    transfer.reveal()
    fireEvent.drop(screen.getByTitle("Content Stack"), { dataTransfer: transfer.transfer })

    await waitFor(() => expect(screen.getByText("Button inserted")).toBeVisible())
    expect(screen.getByTestId("recent-insertions")).toHaveTextContent("button")
    expect(screen.getByTestId("document-nodes").textContent?.match(/:button/g)).toHaveLength(4)
  })

  it("carries an explicit Countdown deadline through a whole-row Layers drop", async () => {
    renderTree({ includeLibrary: true })
    await waitFor(() => expect(screen.getByTitle("Content Stack")).toBeVisible())
    fireEvent.click(screen.getByRole("button", { name: /^Countdown\b/i }))
    fireEvent.change(screen.getByLabelText("Deadline (UTC)"), {
      target: { value: "2029-05-06T07:08" },
    })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Countdown\b/i })).toHaveAttribute(
        "draggable",
        "true",
      ),
    )
    const transfer = createDataTransfer()
    fireEvent.dragStart(screen.getByRole("button", { name: /^Countdown\b/i }), {
      dataTransfer: transfer.transfer,
    })
    expect(transfer.transfer.getData(COMPONENT_LIBRARY_COUNTDOWN_ENDS_AT_DRAG_TYPE)).toBe(
      "2029-05-06T07:08:00Z",
    )

    transfer.protect()
    fireEvent.dragOver(screen.getByTitle("Content Stack"), { dataTransfer: transfer.transfer })
    expect(screen.getByText("Drop inside Content Stack")).toBeVisible()
    transfer.reveal()
    fireEvent.drop(screen.getByTitle("Content Stack"), { dataTransfer: transfer.transfer })

    await waitFor(() => expect(screen.getByText("Countdown inserted")).toBeVisible())
    expect(screen.getByTestId("document-nodes")).toHaveTextContent(":countdown")
    expect(screen.getByTestId("portable-document")).toHaveTextContent("2029-05-06T07:08:00Z")
  })
})
