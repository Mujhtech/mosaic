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

function Harness() {
  const { document } = useEditorStore()
  const { loadTemplate } = useEditorActions()
  useEffect(() => {
    if (!document) loadTemplate(EDITOR_TEMPLATES[0]!.document)
  }, [document, loadTemplate])
  return <PreviewControls />
}

describe("preview controls", () => {
  it("drives the full Local Preview 0.1 accessibility text-scale range", () => {
    render(
      <EditorStoreProvider>
        <Harness />
      </EditorStoreProvider>,
    )

    const slider = screen.getByRole("slider", { name: /text size/i })
    expect(slider).toHaveAttribute("min", "0.5")
    expect(slider).toHaveAttribute("max", "3")
    fireEvent.change(slider, { target: { value: "3" } })
    expect(screen.getByText("Text size · 300%")).toBeInTheDocument()
  })
})
