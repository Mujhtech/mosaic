import { useLayoutEffect, useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { StudioCommandPalette } from "@/features/paywall-editor/components/studio-command-palette"
import type { StudioResizableWorkspaceHandle } from "@/features/paywall-editor/components/studio-resizable-workspace"
import { COMPONENT_CATALOG } from "@/features/paywall-editor/components/component-catalog"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStoreSelector,
} from "@/features/paywall-editor/stores/editor-store-context"
import type { EditorState } from "@/features/paywall-editor/stores/editor-store"
import {
  StudioWorkspaceStoreProvider,
  useStudioWorkspaceSelector,
} from "@/features/paywall-editor/stores/studio-workspace-store-context"
import type { StudioWorkspaceSnapshot } from "@/features/paywall-editor/stores/studio-workspace-store"
import { flattenDocument } from "@/features/paywall-editor/utils/document-tree"

const selectDocument = (state: EditorState) => state.document
const selectSelectedTool = (snapshot: StudioWorkspaceSnapshot) => snapshot.preferences.selectedTool
const selectAppearance = (snapshot: StudioWorkspaceSnapshot) =>
  snapshot.preferences.canvas.appearance

function PaletteHarness({
  controller,
  onExport,
  onRequestImport,
}: {
  controller: StudioResizableWorkspaceHandle
  onExport: () => void
  onRequestImport: () => void
}) {
  const [open, setOpen] = useState(true)
  const document = useEditorStoreSelector(selectDocument)
  const editor = useEditorActions()
  const selectedTool = useStudioWorkspaceSelector(selectSelectedTool)
  const appearance = useStudioWorkspaceSelector(selectAppearance)

  useLayoutEffect(() => {
    if (document) return
    editor.loadTemplate(EDITOR_TEMPLATES[0]!.document)
    editor.selectComponent("headline")
  }, [document, editor])

  if (!document) return null
  const buttons = flattenDocument(document).filter((entry) => entry.node.type === "button")
  const countdowns = flattenDocument(document).filter((entry) => entry.node.type === "countdown")

  function runWorkspaceCommand(command: string) {
    switch (command) {
      case "expand-left":
        controller.expand("left")
        break
      case "toggle-left":
        controller.toggle("left")
        break
      case "toggle-properties":
        controller.toggle("properties")
        break
      case "toggle-diagnostics":
        controller.toggle("diagnostics")
        break
      case "reset":
        controller.reset()
        break
    }
  }

  return (
    <>
      <output data-testid="palette-open">{String(open)}</output>
      <output data-testid="selected-tool">{selectedTool}</output>
      <output data-testid="appearance">{appearance}</output>
      <output data-testid="button-count">{buttons.length}</output>
      <output data-testid="countdown-count">{countdowns.length}</output>
      <output data-testid="button-actions">
        {buttons
          .map((entry) => (entry.node.type === "button" ? entry.node.action.type : ""))
          .join("|")}
      </output>
      <button onClick={() => setOpen(true)} type="button">
        Reopen command palette
      </button>
      <StudioCommandPalette
        onExport={onExport}
        onOpenChange={setOpen}
        onRequestImport={onRequestImport}
        onWorkspaceCommand={runWorkspaceCommand}
        open={open}
      />
    </>
  )
}

function renderPalette() {
  const controller: StudioResizableWorkspaceHandle = {
    collapse: vi.fn(() => true),
    expand: vi.fn(() => true),
    reset: vi.fn(() => true),
    toggle: vi.fn(() => true),
  }
  const onExport = vi.fn()
  const onRequestImport = vi.fn()
  render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <PaletteHarness
          controller={controller}
          onExport={onExport}
          onRequestImport={onRequestImport}
        />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>,
  )
  return { controller, onExport, onRequestImport }
}

describe("StudioCommandPalette", () => {
  it("exposes accessible slugged groups, every supported component, and discoverable hints", () => {
    renderPalette()

    for (const group of ["Add content", "Navigate", "Edit", "Canvas", "Workspace", "File"]) {
      expect(screen.getByRole("region", { name: group })).toBeVisible()
    }
    for (const entry of COMPONENT_CATALOG) {
      expect(screen.getByRole("button", { name: new RegExp(`Add ${entry.label}`) })).toBeVisible()
    }
    expect(screen.getByText("⌘/Ctrl Z")).toBeVisible()
    expect(screen.getByText("G then L")).toBeVisible()
    expect(screen.getByText("[")).toBeVisible()
    expect(document.querySelector('[id="studio-command-group-Add content"]')).toBeNull()
  })

  it("inserts a generic Button directly from the command palette", () => {
    renderPalette()
    expect(screen.getByTestId("button-count")).toHaveTextContent("3")

    fireEvent.click(screen.getByRole("button", { name: /Add Button/ }))

    expect(screen.getByTestId("palette-open")).toHaveTextContent("false")
    expect(screen.getByTestId("button-count")).toHaveTextContent("4")
    expect(screen.getByTestId("button-actions")).toHaveTextContent("close")
  })

  it("routes Countdown to its required deadline step without inserting a default", () => {
    renderPalette()
    expect(screen.getByTestId("countdown-count")).toHaveTextContent("0")

    fireEvent.click(screen.getByRole("button", { name: /Add Countdown/ }))

    expect(screen.getByTestId("selected-tool")).toHaveTextContent("components")
    expect(screen.getByTestId("countdown-count")).toHaveTextContent("0")
    expect(screen.getByTestId("palette-open")).toHaveTextContent("false")
  })

  it("runs feature-owned navigation, workspace, appearance, import, and export actions", () => {
    const { controller, onExport, onRequestImport } = renderPalette()

    fireEvent.click(screen.getByRole("button", { name: /Open Products/ }))
    expect(screen.getByTestId("selected-tool")).toHaveTextContent("products")
    expect(controller.expand).toHaveBeenCalledWith("left")

    fireEvent.click(screen.getByRole("button", { name: "Reopen command palette" }))
    fireEvent.click(screen.getByRole("button", { name: /Use dark canvas appearance/ }))
    expect(screen.getByTestId("appearance")).toHaveTextContent("dark")

    fireEvent.click(screen.getByRole("button", { name: "Reopen command palette" }))
    fireEvent.click(screen.getByRole("button", { name: /Collapse left panel/ }))
    expect(controller.toggle).toHaveBeenCalledWith("left")

    fireEvent.click(screen.getByRole("button", { name: "Reopen command palette" }))
    fireEvent.click(screen.getByRole("button", { name: /Import document/ }))
    expect(onRequestImport).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: "Reopen command palette" }))
    fireEvent.click(screen.getByRole("button", { name: /Export document/ }))
    expect(onExport).toHaveBeenCalledOnce()
  })
})
