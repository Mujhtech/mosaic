import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PaywallEditorWorkspace } from "@/features/paywall-editor/components/paywall-editor-workspace"
import { LOCAL_PROJECT_STORAGE_KEY } from "@/features/paywall-editor/constants/editor-constants"
import { STUDIO_WORKSPACE_STORAGE_KEY } from "@/features/paywall-editor/constants/studio-workspace"
import type { StudioWorkspacePreferencesV1 } from "@/features/paywall-editor/types/studio-workspace"
import {
  installResizableGeometry,
  PointerEventStub,
  ResizeObserverStub,
  restoreResizableGeometry,
} from "@/test/resizable-geometry"

const originalInnerHeight = window.innerHeight
const originalInnerWidth = window.innerWidth
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

function storedWorkspace() {
  return JSON.parse(
    window.localStorage.getItem(STUDIO_WORKSPACE_STORAGE_KEY) ?? "null",
  ) as StudioWorkspacePreferencesV1 | null
}

describe("Studio automated workflow", () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 })
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_500 })
    window.dispatchEvent(new Event("resize"))

    vi.stubGlobal("ResizeObserver", ResizeObserverStub)
    vi.stubGlobal("PointerEvent", PointerEventStub)
    vi.stubGlobal("WebSocket", undefined)
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    )
    installResizableGeometry()

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:mosaic-workflow"),
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    vi.spyOn(window, "confirm").mockReturnValue(true)
  })

  afterEach(() => {
    restoreResizableGeometry()
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    })
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    })
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("completes the first local editing journey and restores document plus workspace state", async () => {
    const startedAt = performance.now()
    const view = render(<PaywallEditorWorkspace />)

    fireEvent.click(screen.getByRole("button", { name: /Focused offer/ }))
    await screen.findByTestId("studio-editor-shell")

    const leftHandle = screen.getByRole("separator", {
      name: "Resize Studio tools and canvas",
    })
    const rightHandle = screen.getByRole("separator", {
      name: "Resize Studio canvas and properties",
    })
    const diagnosticsHandle = screen.getByRole("separator", {
      name: "Resize Studio workspace and diagnostics",
    })
    fireEvent.keyDown(leftHandle, { key: "ArrowRight" })
    fireEvent.keyDown(rightHandle, { key: "ArrowLeft" })
    for (let step = 0; step < 5; step += 1) {
      fireEvent.keyDown(diagnosticsHandle, { key: "ArrowUp" })
    }

    await waitFor(() => {
      expect(storedWorkspace()?.panels.left.size).toBeGreaterThan(300)
      expect(storedWorkspace()?.panels.properties.size).toBeGreaterThan(360)
      expect(storedWorkspace()?.panels.diagnostics.size).toBeCloseTo(405, 0)
    })

    const headline = screen.getByRole("heading", {
      name: "Build a paywall people understand",
    })
    fireEvent.doubleClick(headline)
    const inlineEditor = screen.getByRole("textbox", { name: "Edit headline inline" })
    fireEvent.change(inlineEditor, { target: { value: "Workflow-ready headline" } })
    fireEvent.keyDown(inlineEditor, { key: "Enter" })
    expect(screen.getByRole("heading", { name: "Workflow-ready headline" })).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Components" }))
    const componentPanel = await screen.findByRole("complementary", {
      name: "Add content",
    })
    fireEvent.click(within(componentPanel).getByRole("button", { name: "Text" }))
    fireEvent.click(within(componentPanel).getByRole("button", { name: "Insert Text" }))
    expect(within(componentPanel).getByText("Text inserted")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Layers" }))
    const layersPanel = await screen.findByRole("complementary", { name: "Layers" })
    const selectedLayer = within(layersPanel)
      .getAllByRole("treeitem")
      .find((row) => row.getAttribute("aria-selected") === "true")
    expect(selectedLayer).toBeDefined()
    selectedLayer!.focus()
    fireEvent.keyDown(selectedLayer!, { altKey: true, key: "ArrowDown" })
    expect(within(layersPanel).getByText("Layer moved down")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Products" }))
    const productsPanel = await screen.findByRole("complementary", {
      name: "Test purchase",
    })
    const monthlyPrice = within(productsPanel).getByRole("textbox", {
      name: "Monthly local price",
    })
    fireEvent.change(monthlyPrice, { target: { value: "$9.99" } })
    fireEvent.blur(monthlyPrice)

    const canvas = screen.getByRole("region", { name: "Browser editing preview" })
    fireEvent.click(within(canvas).getByRole("group", { name: "Choose a plan" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit Monthly Product Card" }))
    const initialProduct = screen.getByRole("checkbox", { name: "Initial selection" })
    fireEvent.click(initialProduct)
    expect(initialProduct).toBeChecked()
    expect(within(canvas).getByText("$9.99")).toBeVisible()

    fireEvent.click(within(canvas).getByRole("button", { name: "Continue with selected plan" }))
    const actionSection = document.querySelector<HTMLDetailsElement>(
      'details[data-inspector-section="Actions"]',
    )
    expect(actionSection).not.toBeNull()
    fireEvent.click(actionSection!.querySelector("summary")!)
    expect(screen.getByRole("combobox", { name: "Product selector" })).toHaveValue("plans")

    fireEvent.change(screen.getByRole("combobox", { name: "Preview device" }), {
      target: { value: "pixel-10-pro" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Open preview settings" }))
    fireEvent.change(screen.getByRole("combobox", { name: "Preview locale" }), {
      target: { value: "ar" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: "Force RTL" }))

    const device = canvas.querySelector<HTMLElement>('[data-device-id="pixel-10-pro"]')
    expect(device).not.toBeNull()
    expect(device).toHaveAttribute("data-device-width", "412")
    expect(device?.querySelector('[dir="rtl"]')).not.toBeNull()

    fireEvent.click(within(canvas).getByRole("heading", { level: 1 }))
    const textField = screen.getByRole("textbox", { name: "Text" })
    fireEvent.focus(textField)
    fireEvent.change(textField, { target: { value: "" } })
    fireEvent.blur(textField)
    await waitFor(() => expect(textField).toHaveAttribute("aria-invalid", "true"))

    fireEvent.click(screen.getByRole("button", { name: "Export" }))
    await waitFor(() => expect(textField).toHaveFocus())
    expect(screen.getByRole("alert")).toHaveTextContent("ar is missing paywall.headline")
    expect(URL.createObjectURL).not.toHaveBeenCalled()

    fireEvent.change(textField, { target: { value: "عنوان جاهز للنشر" } })
    fireEvent.blur(textField)
    await waitFor(() => expect(textField).not.toHaveAttribute("aria-invalid"))
    fireEvent.click(screen.getByRole("button", { name: "Export" }))
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mosaic-workflow")

    await waitFor(
      () =>
        expect(window.localStorage.getItem(LOCAL_PROJECT_STORAGE_KEY)).toContain(
          "عنوان جاهز للنشر",
        ),
      { timeout: 1_500 },
    )
    const workspaceBeforeReload = storedWorkspace()
    expect(workspaceBeforeReload).toMatchObject({
      canvas: { device: "pixel-10-pro", locale: "ar", forceRTL: true },
      selectedTool: "products",
    })
    expect(workspaceBeforeReload?.panels.left.size).toBeGreaterThan(300)
    expect(workspaceBeforeReload?.panels.properties.size).toBeGreaterThan(360)

    view.unmount()
    render(<PaywallEditorWorkspace />)
    fireEvent.click(await screen.findByRole("button", { name: "Resume autosave" }))
    await screen.findByTestId("studio-editor-shell")

    expect(screen.getByRole("combobox", { name: "Preview device" })).toHaveValue("pixel-10-pro")
    fireEvent.click(screen.getByRole("button", { name: "Open preview settings" }))
    expect(screen.getByRole("combobox", { name: "Preview locale" })).toHaveValue("ar")
    expect(screen.getByRole("checkbox", { name: "Force RTL" })).toBeChecked()
    const restoredCanvas = screen.getByRole("region", { name: "Browser editing preview" })
    expect(within(restoredCanvas).getByRole("heading", { level: 1 })).toHaveTextContent(
      "عنوان جاهز للنشر",
    )
    expect(screen.getByTestId("studio-left-panel").offsetWidth).toBeCloseTo(
      workspaceBeforeReload!.panels.left.size,
      0,
    )
    expect(screen.getByTestId("studio-properties-panel").offsetWidth).toBeCloseTo(
      workspaceBeforeReload!.panels.properties.size,
      0,
    )
    expect(screen.getByTestId("studio-diagnostics-panel").offsetHeight).toBeCloseTo(
      workspaceBeforeReload!.panels.diagnostics.size,
      0,
    )
    expect(performance.now() - startedAt).toBeLessThan(10_000)
  }, 15_000)
})
