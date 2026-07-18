import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import * as DesignSystem from "@mosaic/design-system"

const { PanelSection, StatusMessage, ToolbarGroup } = DesignSystem

describe("design system", () => {
  it("exports only the approved compositional patterns with native semantics", () => {
    expect(Object.keys(DesignSystem).sort()).toEqual([
      "PanelSection",
      "StatusMessage",
      "ToolbarGroup",
    ])

    render(
      <>
        <div role="toolbar" aria-label="Studio toolbar">
          <ToolbarGroup aria-label="History controls" className="history-group">
            <button type="button">Undo</button>
            <button type="button">Redo</button>
          </ToolbarGroup>
        </div>
        <PanelSection aria-labelledby="layout-heading" className="layout-section">
          <h2 id="layout-heading">Layout</h2>
          <p>Configure the selected surface.</p>
        </PanelSection>
      </>,
    )

    expect(screen.getAllByRole("toolbar")).toHaveLength(1)
    const historyGroup = screen.getByRole("group", { name: "History controls" })
    expect(historyGroup).toHaveClass("mosaic-toolbar-group", "history-group")
    expect(within(historyGroup).getByRole("button", { name: "Undo" })).toBeVisible()

    const section = screen.getByRole("region", { name: "Layout" })
    expect(section).toHaveClass("mosaic-panel-section", "layout-section")
    expect(within(section).getByRole("heading", { name: "Layout", level: 2 })).toBeVisible()
  })

  it("maps status tones to polite status or assertive alert behavior", () => {
    render(
      <>
        <StatusMessage>Draft unchanged</StatusMessage>
        <StatusMessage tone="info">Preview connected</StatusMessage>
        <StatusMessage tone="success" className="save-status">
          Saved locally
        </StatusMessage>
        <StatusMessage tone="warning">Compatibility warning</StatusMessage>
        <StatusMessage tone="danger">Autosave failed</StatusMessage>
      </>,
    )

    const neutral = screen.getByText("Draft unchanged")
    expect(neutral).toHaveRole("status")
    expect(neutral).toHaveAttribute("aria-live", "polite")
    expect(neutral).toHaveAttribute("data-tone", "neutral")

    const info = screen.getByText("Preview connected")
    expect(info).toHaveRole("status")
    expect(info).toHaveAttribute("aria-live", "polite")
    expect(info).toHaveAttribute("data-tone", "info")

    const saved = screen.getByText("Saved locally")
    expect(saved).toHaveRole("status")
    expect(saved).toHaveAttribute("aria-live", "polite")
    expect(saved).toHaveAttribute("aria-atomic", "true")
    expect(saved).toHaveAttribute("data-tone", "success")
    expect(saved).toHaveClass("mosaic-status-message", "save-status")

    const warning = screen.getByText("Compatibility warning")
    expect(warning).toHaveRole("status")
    expect(warning).toHaveAttribute("aria-live", "polite")
    expect(warning).toHaveAttribute("data-tone", "warning")

    const failure = screen.getByRole("alert")
    expect(failure).toHaveTextContent("Autosave failed")
    expect(failure).toHaveAttribute("aria-live", "assertive")
    expect(failure).toHaveAttribute("data-tone", "danger")
  })
})
