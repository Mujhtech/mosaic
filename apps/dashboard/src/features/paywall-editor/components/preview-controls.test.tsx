import { fireEvent, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { describe, expect, it } from "vitest"

import { PreviewControls } from "@/features/paywall-editor/components/preview-controls"
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates"
import {
  EditorStoreProvider,
  useEditorActions,
  useEditorStore,
} from "@/features/paywall-editor/stores/editor-store-context"
import { StudioWorkspaceStoreProvider } from "@/features/paywall-editor/stores/studio-workspace-store-context"
import { findNode } from "@/features/paywall-editor/utils/document-tree"

function Harness() {
  const { document, undoStack } = useEditorStore()
  const { loadTemplate, undo } = useEditorActions()
  useEffect(() => {
    if (!document) loadTemplate(EDITOR_TEMPLATES[0]!.document)
  }, [document, loadTemplate])
  const headline = document ? findNode(document, "headline") : null
  return (
    <>
      <PreviewControls />
      <output data-testid="document-default-locale">
        {document?.localization.defaultLocale ?? "none"}
      </output>
      <output data-testid="headline-default">
        {headline?.type === "text" ? headline.value.default : "none"}
      </output>
      <output data-testid="preview-document-revision">{document?.revision ?? "none"}</output>
      <output data-testid="preview-undo-count">{undoStack.length}</output>
      <output data-testid="preview-document-json">
        {document && JSON.stringify(document).includes("countdownPreviewAt") ? "leaked" : "clean"}
      </output>
      <button onClick={undo} type="button">
        Undo localization change
      </button>
    </>
  )
}

describe("preview controls", () => {
  it("drives the full Local Preview 0.1 accessibility text-scale range", () => {
    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <Harness />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )

    const slider = screen.getByRole("slider", { name: /preview text scale/i })
    expect(slider).toHaveAttribute("min", "0.75")
    expect(slider).toHaveAttribute("max", "1.5")
    fireEvent.change(slider, { target: { value: "1.5" } })
    expect(screen.getByText("150%")).toBeInTheDocument()
  })

  it("changes the portable default locale in one history step without corrupting defaults", () => {
    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <Harness />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )

    fireEvent.change(screen.getByRole("combobox", { name: "Default locale" }), {
      target: { value: "de" },
    })
    expect(screen.getByTestId("document-default-locale")).toHaveTextContent("de")
    expect(screen.getByTestId("headline-default")).toHaveTextContent(
      "Erstelle eine Bezahlschranke, die Menschen sofort verstehen",
    )
    fireEvent.click(screen.getByRole("button", { name: "Undo localization change" }))
    expect(screen.getByTestId("document-default-locale")).toHaveTextContent("en")
  })

  it("keeps a frozen Countdown instant in workspace state and advances it without document history", () => {
    render(
      <StudioWorkspaceStoreProvider storage={null}>
        <EditorStoreProvider>
          <Harness />
        </EditorStoreProvider>
      </StudioWorkspaceStoreProvider>,
    )

    const deadline = screen.getByLabelText("Countdown preview instant (UTC)")
    expect(deadline).toHaveValue("2026-01-01T12:00")
    const revision = screen.getByTestId("preview-document-revision").textContent
    const undoCount = screen.getByTestId("preview-undo-count").textContent

    fireEvent.click(screen.getByRole("button", { name: "Advance Countdown preview by 1 day" }))
    expect(deadline).toHaveValue("2026-01-02T12:00")
    fireEvent.change(deadline, { target: { value: "2031-04-05T06:07:08" } })
    expect(deadline).toHaveValue("2031-04-05T06:07:08.000")

    expect(screen.getByTestId("preview-document-revision")).toHaveTextContent(revision ?? "")
    expect(screen.getByTestId("preview-undo-count")).toHaveTextContent(undoCount ?? "")
    expect(screen.getByTestId("preview-document-json")).toHaveTextContent("clean")
    expect(screen.getByText(/Frozen workspace-only time/)).toBeVisible()
  })
})
