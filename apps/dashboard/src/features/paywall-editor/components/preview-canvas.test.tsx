import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useLayoutEffect } from "react"
import { describe, expect, it } from "vitest"

import { COMPONENT_LIBRARY_DRAG_TYPE } from "@/features/paywall-editor/components/component-catalog"
import { ComponentLibrary } from "@/features/paywall-editor/components/component-library"
import {
  calculateCanvasScale,
  resolveCanvasDeviceGeometry,
} from "@/features/paywall-editor/components/canvas-preview-geometry"
import { PreviewCanvas } from "@/features/paywall-editor/components/preview-canvas"
import { DEFAULT_MOCK_PRODUCTS } from "@/features/paywall-editor/constants/editor-constants"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import {
  StudioWorkspaceStoreProvider,
  useStudioWorkspaceActions,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import { useWorkspacePreviewContext } from "@/features/paywall-editor/hooks/use-workspace-preview-context"
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree"

type MetadataMode =
  | "none"
  | "lock-headline"
  | "hide-headline"
  | "hide-root"
  | "semantic-elements"
  | "countdown"
  | "rtl-icon"
  | "name-only-missing-price"
  | "product-state-preview"
  | "fixed-product-card"
  | "frame-position"

function InitializePreview({ mode }: { mode: MetadataMode }) {
  const editor = useEditorActions()
  const workspace = useStudioWorkspaceActions()

  useLayoutEffect(() => {
    if (editor.getSnapshot().document) return
    const document = EDITOR_TEMPLATES[mode === "semantic-elements" ? 1 : 0]!.document
    editor.loadTemplate(document)
    if (mode === "fixed-product-card") {
      editor.updateComponent("monthly-card", (node) =>
        node.type === "productCard"
          ? {
              ...node,
              sizing: {
                width: { mode: "fixed", value: 164 },
                height: { mode: "fixed", value: 96 },
              },
            }
          : node,
      )
    }
    if (mode === "product-state-preview") {
      editor.selectComponent("monthly-card")
      editor.setProductLayerPreview({ nodeId: "monthly-card", state: "selected" })
    }
    if (mode === "frame-position") {
      workspace.setFramePosition("main", { x: 123.5, y: -45.25 })
    }
    if (mode === "name-only-missing-price") {
      editor.updateComponent("monthly-card", (node) =>
        node.type === "productCard"
          ? { ...node, children: node.children.filter((child) => child.id !== "monthly-price") }
          : node,
      )
    }
    if (mode === "countdown") {
      editor.insertComponentAt(
        "countdown",
        {
          parentId: document.screens[0]!.layout.content.id,
          index: document.screens[0]!.layout.content.children.length,
        },
        { countdownEndsAt: "2026-01-02T12:00:00Z" },
      )
    }
    if (mode === "rtl-icon") {
      const inserted = editor.insertComponentAt("icon", {
        parentId: document.screens[0]!.layout.content.id,
        index: 1,
      })
      if (inserted.status === "accepted") {
        editor.updateComponent(inserted.nodeId, (node) =>
          node.type === "icon" ? { ...node, name: "arrowBackward" } : node,
        )
      }
    }
    if (mode === "semantic-elements") {
      editor.insertComponentAt("image", {
        parentId: document.screens[0]!.layout.content.id,
        index: 2,
      })
    }
    if (mode === "lock-headline") {
      workspace.setLayerLocked("headline", true)
      editor.selectComponent("subtitle")
    }
    if (mode === "hide-headline") workspace.setLayerCanvasHidden("headline", true)
    if (mode === "hide-root") {
      workspace.setLayerCanvasHidden(document.screens[0]!.layout.content.id, true)
    }
  }, [editor, mode, workspace])

  return null
}

function PreviewProbe() {
  const {
    currentLocale,
    document,
    hoveredComponentId,
    productLayerPreview,
    selectedComponentId,
    textScale,
    undoStack,
  } = useEditorStore()
  const { selectComponent, undo } = useEditorActions()
  const buttons = document
    ? flattenDocument(document).filter((entry) => entry.node.type === "button")
    : []
  return (
    <div>
      <output data-testid="preview-hovered">{hoveredComponentId ?? "none"}</output>
      <output data-testid="preview-selected">{selectedComponentId ?? "none"}</output>
      <output data-testid="preview-buttons">{buttons.length}</output>
      <output data-testid="preview-undo">{undoStack.length}</output>
      <output data-testid="preview-product-state">
        {productLayerPreview
          ? `${productLayerPreview.nodeId}:${productLayerPreview.state}`
          : "none"}
      </output>
      <output data-testid="preview-locale">{currentLocale}</output>
      <output data-testid="preview-text-scale">{textScale}</output>
      <output data-testid="preview-order">
        {document
          ? flattenDocument(document)
              .map((entry) => entry.node.id)
              .join(",")
          : ""}
      </output>
      <output data-testid="preview-document-json">
        {document && JSON.stringify(document).includes("countdownPreviewAt") ? "leaked" : "clean"}
      </output>
      <button onClick={undo} type="button">
        Undo canvas change
      </button>
      <button onClick={() => selectComponent("purchase-progress")} type="button">
        Preview purchase progress
      </button>
    </div>
  )
}

function PreviewContextBridge() {
  useWorkspacePreviewContext()
  return null
}

function renderPreview(
  mode: MetadataMode = "none",
  includeLibrary = false,
  mockProducts = DEFAULT_MOCK_PRODUCTS,
) {
  return render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InitializePreview mode={mode} />
        <PreviewContextBridge />
        {includeLibrary ? <ComponentLibrary /> : null}
        <PreviewCanvas mockProducts={mockProducts} mockPurchaseState="productAvailable" />
        <PreviewProbe />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )
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

describe("PreviewCanvas layer metadata", () => {
  it("blocks canvas selection and inline editing for locked layers while preserving hover sync", async () => {
    const view = renderPreview("lock-headline")
    const heading = await screen.findByRole("heading", {
      name: "Build a paywall people understand",
    })
    const headline = view.container.querySelector<HTMLElement>('[data-component-id="headline"]')
    expect(headline).not.toBeNull()
    expect(headline).toHaveAttribute("aria-disabled", "true")

    fireEvent.click(heading)
    expect(screen.getByTestId("preview-selected")).toHaveTextContent("subtitle")
    fireEvent.doubleClick(heading)
    expect(screen.queryByRole("textbox", { name: "Edit headline inline" })).not.toBeInTheDocument()

    fireEvent.mouseEnter(headline!)
    expect(screen.getByTestId("preview-hovered")).toHaveTextContent("headline")
    fireEvent.mouseLeave(headline!)
    expect(screen.getByTestId("preview-hovered")).toHaveTextContent("none")
  })

  it("uses protocol-appropriate HTML and keeps structural editing out of the canvas", async () => {
    const view = renderPreview("semantic-elements")
    const heading = await screen.findByRole("heading", {
      name: "Build a paywall people understand",
      level: 1,
    })
    const body = screen.getByText(/Edit once and preview the same native document/)
    const productSelector = screen.getByRole("group", { name: "Choose a plan" })
    const featureList = screen.getByRole("list", { name: "What is included" })
    const purchase = screen.getByRole("button", { name: "Continue with selected plan" })
    const imageFrame = view.container.querySelector<HTMLElement>('[data-preview-node-type="image"]')

    expect(heading.tagName).toBe("H1")
    expect(heading.closest("button")).toBeNull()
    expect(body.tagName).toBe("P")
    expect(body.closest("button")).toBeNull()
    expect(featureList.tagName).toBe("UL")
    expect(featureList.querySelectorAll("li")).toHaveLength(2)
    expect(imageFrame?.firstElementChild?.tagName).toBe("FIGURE")
    expect(productSelector.tagName).toBe("FIELDSET")
    expect(screen.getAllByRole("radio")).toHaveLength(2)
    expect(purchase.closest('[data-component-id="purchase"]')).toHaveTextContent("Continue")
    expect(purchase.querySelector("div, textarea")).toBeNull()
    expect(screen.getByRole("button", { name: "Restore previous purchases" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible()
    expect(screen.queryByRole("button", { name: /^Select / })).not.toBeInTheDocument()
    expect(screen.queryByRole("toolbar", { name: /^Actions for / })).not.toBeInTheDocument()

    const previewFrames = view.container.querySelectorAll<HTMLElement>("[data-preview-node-type]")
    expect(previewFrames.length).toBeGreaterThan(0)
    previewFrames.forEach((frame) => expect(frame).not.toHaveAttribute("draggable"))
    expect(screen.getByTestId("rf__node-studio-device-preview")).toHaveStyle({
      pointerEvents: "auto",
    })

    fireEvent.click(heading)
    expect(screen.getByTestId("preview-selected")).toHaveTextContent("headline")

    const undoCount = screen.getByTestId("preview-undo").textContent
    fireEvent.click(purchase)
    expect(screen.getByTestId("preview-selected")).toHaveTextContent("purchase")
    expect(screen.getByTestId("preview-undo")).toHaveTextContent(undoCount ?? "")
    fireEvent.click(screen.getByRole("radio", { name: /Monthly/ }))
    expect(screen.getByTestId("preview-selected")).toHaveTextContent("monthly-card")
    expect(screen.getByTestId("preview-undo")).toHaveTextContent(undoCount ?? "")
  })

  it("keeps name-only Product Cards available when the provider price is blank", async () => {
    const productsWithoutPrices = DEFAULT_MOCK_PRODUCTS.map((product) => ({
      ...product,
      localizedPrice: " ",
    }))
    renderPreview("name-only-missing-price", false, productsWithoutPrices)

    expect(await screen.findByRole("radio", { name: "Monthly" })).toBeVisible()
    expect(screen.queryByRole("radio", { name: /Yearly/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Continue with selected plan" })).toBeEnabled()
  })

  it("previews a Product Card state without changing runtime selection or document history", async () => {
    const view = renderPreview("product-state-preview")
    const monthly = await screen.findByRole("radio", { name: /Monthly/ })
    const card = view.container.querySelector<HTMLElement>(
      '[data-component-id="monthly-card"] label',
    )

    expect(monthly).not.toBeChecked()
    expect(card).toHaveStyle({ borderWidth: "2px" })
    expect(screen.getByTestId("preview-product-state")).toHaveTextContent("monthly-card:selected")
    expect(screen.getByTestId("preview-undo")).toHaveTextContent("0")
  })

  it("honours fixed Product Card size and clips visual overflow without flex growth", async () => {
    const view = renderPreview("fixed-product-card")
    const card = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>(
        '[data-component-id="monthly-card"]',
      )
      expect(element).not.toBeNull()
      return element!
    })

    expect(card).toHaveStyle({ height: "96px", overflow: "hidden", width: "164px" })
    expect(card).not.toHaveClass("flex-1")
  })

  it("previews Button in-progress children when their layer is selected", async () => {
    renderPreview()
    const purchase = await screen.findByRole("button", {
      name: "Continue with selected plan",
    })
    const purchaseFrame = purchase.closest('[data-component-id="purchase"]')
    expect(purchaseFrame).toHaveTextContent("Continue")

    fireEvent.click(screen.getByRole("button", { name: "Preview purchase progress" }))

    expect(purchase).toHaveAttribute("aria-busy", "true")
    expect(purchaseFrame).toHaveTextContent("Processing purchase…")
    expect(purchaseFrame).not.toHaveTextContent(/^Continue$/)
  })

  it("keeps inline editors outside the semantic Button element", async () => {
    renderPreview()
    const label = await screen.findByText("Continue")

    fireEvent.doubleClick(label)

    const editor = screen.getByRole("textbox", { name: "Edit text inline" })
    expect(editor.closest("button")).toBeNull()
    fireEvent.keyDown(editor, { key: "Escape" })
  })

  it("mirrors directional Icon glyphs in RTL preview", async () => {
    renderPreview("rtl-icon")
    expect(await screen.findByText("←")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Open preview settings" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Force RTL" }))

    expect(await screen.findByText("→")).toBeVisible()
    expect(screen.queryByText("←")).not.toBeInTheDocument()
  })

  it("removes hidden layers and explains a hidden root Stack without mutating the document", async () => {
    const hiddenHeadline = renderPreview("hide-headline")
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Build a paywall people understand" }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/Edit once and preview the same native document/).tagName).toBe("P")
    expect(screen.getByTestId("preview-undo")).toHaveTextContent("0")
    hiddenHeadline.unmount()

    renderPreview("hide-root")
    await waitFor(() =>
      expect(screen.getByText(/Content Stack is hidden on the canvas/)).toBeVisible(),
    )
    expect(
      screen.queryByRole("heading", { name: "Build a paywall people understand" }),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId("preview-undo")).toHaveTextContent("0")
  })

  it("accepts a generic Button drop after MIME-only dragover", async () => {
    renderPreview("none", true)
    await waitFor(() => expect(screen.getByRole("button", { name: "Button" })).toBeVisible())
    const transfer = createDataTransfer()
    fireEvent.dragStart(screen.getByRole("button", { name: "Button" }), {
      dataTransfer: transfer.transfer,
    })
    expect(transfer.transfer.getData(COMPONENT_LIBRARY_DRAG_TYPE)).toBe("button")

    transfer.protect()
    fireEvent.dragOver(screen.getByRole("region", { name: "Browser editing preview" }), {
      dataTransfer: transfer.transfer,
    })
    expect(screen.getByText("Drop to insert at the current Layers selection.")).toBeVisible()

    transfer.reveal()
    fireEvent.drop(screen.getByRole("region", { name: "Browser editing preview" }), {
      dataTransfer: transfer.transfer,
    })

    await waitFor(() => expect(screen.getByTestId("preview-buttons")).toHaveTextContent("4"))
    expect(screen.getByTestId("preview-undo")).toHaveTextContent("1")
    expect(screen.getByText(/Button inserted/)).toBeVisible()
  })

  it("keeps workspace device, orientation, zoom, context, and appearance outside document history", async () => {
    renderPreview()
    const region = await screen.findByRole("region", { name: "Browser editing preview" })
    let device = region.querySelector<HTMLElement>("[data-device-width]")
    expect(device).toHaveAttribute("data-device-width", "402")
    expect(device).toHaveAttribute("data-device-height", "874")
    expect(device).toHaveAttribute("data-device-platform", "ios")
    expect(device?.querySelector('[data-device-sensor="dynamic-island"]')).not.toBeNull()
    expect(device?.querySelector("[data-device-camera-lens]")).not.toBeNull()
    expect(device?.querySelector('[data-device-drag-surface="status-bar"]')).toBeNull()
    expect(screen.getByTestId("device-name-label")).toHaveTextContent("iPhone 17 Pro")
    expect(screen.getByTestId("device-size-label")).toHaveTextContent('6.3" · 402 × 874 pt')
    expect(device?.querySelector('[data-system-icon="ios-cellular"]')).not.toBeNull()
    expect(device?.querySelector('[data-system-icon="ios-wifi"]')).not.toBeNull()
    expect(device?.querySelector('[data-system-icon="ios-battery"]')).toHaveAttribute(
      "data-battery-percent",
      "82",
    )
    expect(screen.getByTestId("device-status-bar")).toHaveTextContent("9:41")
    expect(screen.getByTestId("device-status-bar")).toHaveTextContent("82")
    expect(screen.getByTestId("device-status-bar")).toHaveStyle({ paddingInline: "35px" })

    fireEvent.change(screen.getByRole("combobox", { name: "Preview device" }), {
      target: { value: "iphone-17-pro-max" },
    })
    expect(screen.getByTestId("device-status-bar")).toHaveStyle({ paddingInline: "40px" })
    fireEvent.change(screen.getByRole("combobox", { name: "Preview device" }), {
      target: { value: "iphone-17-pro" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Use landscape orientation" }))
    device = region.querySelector<HTMLElement>("[data-device-width]")
    expect(device).toHaveAttribute("data-device-width", "874")
    expect(device).toHaveAttribute("data-device-height", "402")

    fireEvent.change(screen.getByRole("combobox", { name: "Preview device" }), {
      target: { value: "pixel-10-pro" },
    })
    device = region.querySelector<HTMLElement>("[data-device-width]")
    expect(device).toHaveAttribute("data-device-width", "920")
    expect(device).toHaveAttribute("data-device-height", "412")
    expect(device).toHaveAttribute("data-device-platform", "android")
    expect(device?.querySelector('[data-device-sensor="punch-hole"]')).not.toBeNull()
    expect(device?.querySelector('[data-system-icon="ios-cellular"]')).toBeNull()
    expect(screen.getByTestId("device-status-bar")).toHaveTextContent("12:45")
    expect(screen.getByTestId("device-status-bar")).toHaveTextContent("82%")

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    expect(device).toHaveAttribute("data-canvas-fit-mode", "manual")
    expect(device).toHaveAttribute("data-effective-zoom", "1.100")
    fireEvent.click(screen.getByRole("button", { name: "Fit device to canvas" }))
    expect(device).toHaveAttribute("data-canvas-fit-mode", "fit")

    fireEvent.click(screen.getByRole("button", { name: "Open preview settings" }))
    fireEvent.change(screen.getByRole("combobox", { name: "Preview locale" }), {
      target: { value: "ar" },
    })
    await waitFor(() => expect(screen.getByTestId("preview-locale")).toHaveTextContent("ar"))
    fireEvent.change(screen.getByRole("slider", { name: /Preview text scale/i }), {
      target: { value: "1.5" },
    })
    await waitFor(() => expect(screen.getByTestId("preview-text-scale")).toHaveTextContent("1.5"))
    fireEvent.click(screen.getByRole("button", { name: "Dark" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Force RTL" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Safe area" }))

    expect(screen.queryByTestId("canvas-safe-area")).not.toBeInTheDocument()
    expect(screen.getByTestId("preview-undo")).toHaveTextContent("0")
  })

  it("restores a screen frame position from workspace preferences without document history", async () => {
    renderPreview("frame-position")

    const frame = await screen.findByTestId("rf__node-studio-device-preview")
    await waitFor(() => expect(frame.style.transform).toContain("translate(123.5px,-45.25px)"))
    expect(screen.getByTestId("preview-undo")).toHaveTextContent("0")
    expect(screen.getByTestId("preview-document-json")).toHaveTextContent("clean")
  })

  it("previews Countdown from frozen workspace time and advances to completion without mutation", async () => {
    renderPreview("countdown")
    expect(await screen.findByText(/01 day\s+00 hours/)).toBeVisible()
    expect(screen.queryByText("Offer ended")).not.toBeInTheDocument()
    const undoCount = screen.getByTestId("preview-undo").textContent

    fireEvent.click(screen.getByRole("button", { name: "Open preview settings" }))
    fireEvent.click(screen.getByRole("button", { name: "Advance Countdown preview by 1 day" }))

    await waitFor(() => expect(screen.getByText("Offer ended")).toBeVisible())
    expect(screen.getByTestId("preview-undo")).toHaveTextContent(undoCount ?? "")
    expect(screen.getByTestId("preview-document-json")).toHaveTextContent("clean")
  })

  it("uses a double-click transaction for inline edits and cancels without history", async () => {
    renderPreview()
    const headline = await screen.findByRole("heading", {
      name: "Build a paywall people understand",
    })
    fireEvent.click(headline)
    expect(screen.queryByRole("textbox", { name: "Edit headline inline" })).not.toBeInTheDocument()

    fireEvent.doubleClick(headline)
    const editor = screen.getByRole("textbox", { name: "Edit headline inline" })
    expect(editor).toHaveFocus()
    fireEvent.change(editor, { target: { value: "First pass" } })
    fireEvent.change(editor, { target: { value: "Final inline headline" } })
    expect(screen.getByTestId("preview-undo")).toHaveTextContent("0")
    fireEvent.keyDown(editor, { key: "Enter" })
    expect(screen.getByRole("heading", { name: "Final inline headline" })).toBeVisible()
    expect(screen.getByTestId("preview-undo")).toHaveTextContent("1")

    fireEvent.doubleClick(screen.getByRole("heading", { name: "Final inline headline" }))
    const cancelEditor = screen.getByRole("textbox", { name: "Edit headline inline" })
    fireEvent.change(cancelEditor, { target: { value: "Cancelled value" } })
    fireEvent.keyDown(cancelEditor, { key: "Escape" })
    expect(screen.getByRole("heading", { name: "Final inline headline" })).toBeVisible()
    expect(screen.getByTestId("preview-undo")).toHaveTextContent("1")

    fireEvent.click(screen.getByRole("button", { name: "Undo canvas change" }))
    expect(screen.getByRole("heading", { name: "Build a paywall people understand" })).toBeVisible()
  })

  it("keeps the device and preview frames non-draggable and navigates layers by keyboard", async () => {
    const view = renderPreview()
    await screen.findByRole("heading", { name: "Build a paywall people understand" })
    const device = view.container.querySelector<HTMLElement>("[data-device-id]")
    expect(device).not.toHaveClass("cursor-grab")
    expect(view.container.querySelector("[data-device-drag-surface]")).toBeNull()
    view.container
      .querySelectorAll<HTMLElement>("[data-preview-node-type]")
      .forEach((frame) => expect(frame).not.toHaveAttribute("draggable"))

    const viewport = screen.getByTestId("canvas-viewport")
    viewport.focus()
    fireEvent.keyDown(viewport, { key: "ArrowDown" })
    expect(screen.getByTestId("preview-selected")).not.toHaveTextContent("none")
  })
})

describe("Canvas geometry", () => {
  it("keeps device and orientation independent and clamps fit to the 20–200% workspace range", () => {
    expect(resolveCanvasDeviceGeometry("ipad-pro-11", "portrait")).toMatchObject({
      height: 1210,
      width: 834,
    })
    expect(resolveCanvasDeviceGeometry("ipad-pro-11", "landscape")).toMatchObject({
      height: 834,
      width: 1210,
    })
    expect(
      calculateCanvasScale({
        availableHeight: 100,
        availableWidth: 100,
        geometry: { height: 1024, width: 768 },
        preferences: { fitMode: "fit", zoom: 1 },
      }),
    ).toBe(0.2)
    expect(
      calculateCanvasScale({
        availableHeight: 4_000,
        availableWidth: 4_000,
        geometry: { height: 844, width: 390 },
        preferences: { fitMode: "fit", zoom: 1 },
      }),
    ).toBe(2)
  })
})
