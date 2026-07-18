import { useLayoutEffect } from "react"
import type { RefObject } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { StudioResizableWorkspaceHandle } from "@/features/paywall-editor/components/studio-resizable-workspace"
import { StudioToolPanel } from "@/features/paywall-editor/components/studio-tool-panel"
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
import type { StudioTool } from "@/features/paywall-editor/types/studio-workspace"
import type { StudioViewportMode } from "@/features/paywall-editor/hooks/use-studio-viewport-mode"
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree"

function InitializeTool({ tool }: { tool: StudioTool }) {
  const editor = useEditorActions()
  const workspace = useStudioWorkspaceActions()

  useLayoutEffect(() => {
    if (!editor.getSnapshot().document) editor.loadTemplate(EDITOR_TEMPLATES[0]!.document)
    workspace.setSelectedTool(tool)
  }, [editor, tool, workspace])

  return null
}

function createWorkspaceController() {
  return {
    collapse: vi.fn(() => true),
    expand: vi.fn(() => true),
    reset: vi.fn(() => true),
    toggle: vi.fn(() => true),
  } satisfies StudioResizableWorkspaceHandle
}

function ToolPanelProbe() {
  const editor = useEditorActions()
  const { document, undoStack } = useEditorStore()
  const featureCount = document
    ? flattenDocument(document).filter((entry) => entry.node.type === "featureList").length
    : 0

  return (
    <div>
      <button type="button" onClick={editor.undo}>
        Undo template replacement
      </button>
      <output data-testid="tool-document-id">{document?.id ?? "none"}</output>
      <output data-testid="tool-feature-count">{featureCount}</output>
      <output data-testid="tool-undo-count">{undoStack.length}</output>
      <output data-testid="tool-document-json">{document ? JSON.stringify(document) : ""}</output>
    </div>
  )
}

function renderTool(tool: StudioTool, viewportMode: StudioViewportMode = "large") {
  const controller = createWorkspaceController()
  const workspaceControllerRef = {
    current: controller,
  } as RefObject<StudioResizableWorkspaceHandle | null>

  render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InitializeTool tool={tool} />
        <StudioToolPanel
          assets={[]}
          mockProducts={DEFAULT_MOCK_PRODUCTS}
          mockPurchaseState="productAvailable"
          onProductsChange={vi.fn()}
          onPurchaseStateChange={vi.fn()}
          previewClients={[]}
          viewportMode={viewportMode}
          workspaceControllerRef={workspaceControllerRef}
        />
        <ToolPanelProbe />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )

  return controller
}

describe("StudioToolPanel", () => {
  it("keeps structure in Layers and the insertion path in Components", async () => {
    const layers = renderTool("layers")

    await waitFor(() => expect(screen.getByRole("heading", { name: "Layers" })).toBeVisible())
    expect(screen.getByRole("complementary", { name: "Layers" })).toBeVisible()
    expect(screen.getByRole("tree", { name: "Paywall component tree" })).toBeVisible()
    expect(screen.getAllByRole("treeitem")[0]).toHaveAttribute("aria-level", "1")
    expect(screen.queryByRole("button", { name: "Insert Text" })).not.toBeInTheDocument()
    expect(layers.reset).not.toHaveBeenCalled()
  })

  it("presents the exact searchable Add content catalog", async () => {
    renderTool("components")

    await waitFor(() => expect(screen.getByRole("button", { name: "Insert Text" })).toBeEnabled())
    expect(screen.getByRole("heading", { name: "Add content" })).toBeVisible()

    const commerce = screen.getByRole("heading", { name: "Commerce" }).closest("section")
    expect(commerce).not.toBeNull()
    expect(commerce).toHaveTextContent("Product Selector")
    expect(commerce).toHaveTextContent("Button")
    expect(commerce).not.toHaveTextContent("Purchase")
    expect(commerce).not.toHaveTextContent("Restore")
    expect(commerce).not.toHaveTextContent("Legal")
    expect(commerce).not.toHaveTextContent("Close")

    fireEvent.change(screen.getByRole("searchbox", { name: "Search components" }), {
      target: { value: "feature" },
    })
    expect(screen.getByText("Feature List")).toBeVisible()
    expect(screen.queryByText("Vertical Stack")).not.toBeInTheDocument()
  })

  it.each([
    ["templates", "Templates", "Focused offer"],
    [
      "designSystem",
      "Design System",
      "Add colours to make them available at the top of every colour picker.",
    ],
    ["products", "Test purchase", "Test purchase"],
    ["localization", "Preview context", "Preview context"],
    ["assets", "Assets", "No assets"],
  ] as const)("renders the owned %s surface", async (tool, panelName, content) => {
    renderTool(tool)

    await waitFor(() => expect(screen.getByText(content)).toBeVisible())
    expect(screen.getByRole("complementary", { name: panelName })).toBeVisible()
    if (tool === "templates") {
      expect(screen.getByRole("list", { name: "Bundled templates" })).toBeVisible()
    }
  })

  it("authors a reusable design-system colour as an undoable document change", async () => {
    renderTool("designSystem")

    fireEvent.click(await screen.findByRole("button", { name: "Add colours style" }))

    expect(screen.getByRole("textbox", { name: "Name for Colour 1" })).toHaveValue("Colour 1")
    expect(screen.getByLabelText("Colour 1")).toHaveValue("#087F73FF")
    expect(screen.getByTestId("tool-undo-count")).toHaveTextContent("1")
  })

  it("keeps one compact design-system editor open and authors valid gradient stops", async () => {
    renderTool("designSystem")

    fireEvent.click(await screen.findByRole("button", { name: "Add colours style" }))
    expect(screen.getByRole("textbox", { name: "Name for Colour 1" })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Add backgrounds style" }))

    expect(screen.queryByRole("textbox", { name: "Name for Colour 1" })).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Name for Background 1" })).toBeVisible()
    const kind = screen.getByRole("combobox", { name: "Background kind" })
    fireEvent.change(kind, { target: { value: "linearGradient" } })
    fireEvent.click(screen.getByRole("button", { name: "Add stop" }))

    expect(screen.getByTestId("tool-document-json")).toHaveTextContent('"position":0.5')
    expect(screen.getByRole("spinbutton", { name: "Angle" })).toHaveAttribute("min", "0")
  })

  it("recovers a media design style by creating and selecting a valid asset", async () => {
    renderTool("designSystem")

    fireEvent.click(await screen.findByRole("button", { name: "Add backgrounds style" }))
    expect(screen.getByRole("combobox", { name: "Background kind" })).toHaveAccessibleName(
      "Background kind",
    )
    fireEvent.click(screen.getByRole("button", { name: "Add image" }))

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Background kind" })).toHaveValue("image"),
    )
    expect(screen.getByTestId("tool-document-json")).toHaveTextContent(
      '"type":"image","id":"image-1"',
    )
    expect(screen.getByTestId("tool-document-json")).toHaveTextContent(
      '"type":"image","assetId":"image-1"',
    )
  })

  it("confirms and applies a template in place as one undoable document edit", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderTool("templates")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Use Benefits first" })).toBeEnabled(),
    )

    fireEvent.click(screen.getByRole("button", { name: "Use Benefits first" }))
    expect(confirm).toHaveBeenLastCalledWith(
      "Replace this single local draft with Benefits first? Undo restores the current draft.",
    )
    expect(screen.getByTestId("tool-document-id")).toHaveTextContent("focused-offer")
    expect(screen.getByTestId("tool-undo-count")).toHaveTextContent("0")

    fireEvent.click(screen.getByRole("button", { name: "Use Benefits first" }))
    await waitFor(() =>
      expect(screen.getByTestId("tool-document-id")).toHaveTextContent("benefits-first"),
    )
    expect(screen.getByTestId("tool-feature-count")).toHaveTextContent("1")
    expect(screen.getByTestId("tool-undo-count")).toHaveTextContent("1")
    expect(screen.getByText(/Undo restores the previous draft/)).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Undo template replacement" }))
    expect(screen.getByTestId("tool-document-id")).toHaveTextContent("focused-offer")
    expect(screen.getByTestId("tool-feature-count")).toHaveTextContent("0")
  })

  it("routes workspace settings through the accepted controller", async () => {
    const controller = renderTool("settings")

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reset workspace layout" })).toBeEnabled(),
    )
    screen.getByRole("button", { name: "Toggle diagnostics" }).click()
    screen.getByRole("button", { name: "Reset workspace layout" }).click()

    expect(controller.toggle).toHaveBeenCalledWith("diagnostics")
    expect(controller.reset).toHaveBeenCalledOnce()
  })

  it("points compact users to the sheet trigger instead of exposing a dead panel command", async () => {
    renderTool("settings", "compact")

    await waitFor(() =>
      expect(
        screen.getByText("Use the Properties button on the canvas in compact mode."),
      ).toBeVisible(),
    )
    expect(screen.queryByRole("button", { name: "Toggle properties" })).not.toBeInTheDocument()
  })
})
