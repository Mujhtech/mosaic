import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ValidationPanel } from "@/features/paywall-editor/components/validation-panel"
import { EditorStoreProvider } from "@/features/paywall-editor/stores/editor-store-context"
import type { ValidationIssue } from "@/features/paywall-editor/types/editor"

const componentIssue: ValidationIssue = {
  code: "localization.emptyValue",
  componentId: "headline",
  documentPath: "/layout/content/children/1/value",
  message: "Visible text cannot be empty.",
  property: "value",
  recovery: "Enter text in the property inspector.",
  severity: "error",
}

describe("ValidationPanel", () => {
  it("routes an ordinary component issue through the shared nonmodal navigation callback", () => {
    const onNavigate = vi.fn()
    render(
      <EditorStoreProvider>
        <ValidationPanel issues={[componentIssue]} onNavigate={onNavigate} />
      </EditorStoreProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Fix in Properties" }))
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenCalledWith(componentIssue)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps document-level recovery actionable without inventing a component selection", () => {
    const issue: ValidationIssue = {
      code: "localization.missingDefault",
      documentPath: "/localization/defaultLocale",
      message: "The default locale has no catalog.",
      property: "defaultLocale",
      recovery: "Choose an available default locale.",
      severity: "error",
    }
    const onNavigate = vi.fn()
    render(
      <EditorStoreProvider>
        <ValidationPanel issues={[issue]} onNavigate={onNavigate} />
      </EditorStoreProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Show recovery controls" }))
    expect(onNavigate).toHaveBeenCalledWith(issue)
  })
})
