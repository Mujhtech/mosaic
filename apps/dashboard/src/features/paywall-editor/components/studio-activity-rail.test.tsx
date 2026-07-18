import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { StudioActivityRail } from "@/features/paywall-editor/components/studio-activity-rail"

const toolLabels = [
  "Layers",
  "Components",
  "Templates",
  "Design System",
  "Products",
  "Localization",
  "Assets",
  "Settings",
] as const

function renderRail({
  selectedTool = "layers",
  collapsed = false,
  onOpenCommands = vi.fn(),
  onSelectTool = vi.fn(),
  onToggleActiveTool = vi.fn(),
}: Partial<React.ComponentProps<typeof StudioActivityRail>> = {}) {
  return {
    onSelectTool,
    onToggleActiveTool,
    onOpenCommands,
    ...render(
      <TooltipProvider>
        <StudioActivityRail
          collapsed={collapsed}
          onOpenCommands={onOpenCommands}
          onSelectTool={onSelectTool}
          onToggleActiveTool={onToggleActiveTool}
          selectedTool={selectedTool}
        />
      </TooltipProvider>,
    ),
  }
}

describe("StudioActivityRail", () => {
  it("renders the exact ordered, unique Studio tool set in a fixed 52px rail", () => {
    renderRail()

    const rail = screen.getByRole("navigation", { name: "Studio activity" })
    const toolbar = within(rail).getByRole("toolbar", { name: "Studio tools" })
    const buttons = within(toolbar).getAllByRole("button")

    expect(rail).toHaveAttribute("data-rail-width", "52")
    expect(rail).toHaveClass("w-[52px]", "min-w-[52px]", "max-w-[52px]")
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(toolLabels)

    const toolIds = buttons.map((button) => button.id)
    expect(new Set(toolIds).size).toBe(toolIds.length)
  })

  it("pins an icon-only command trigger to the bottom of the tool rail", () => {
    const onOpenCommands = vi.fn()
    renderRail({ onOpenCommands })

    const rail = screen.getByRole("navigation", { name: "Studio activity" })
    const commandGroup = within(rail).getByRole("group", { name: "Studio commands" })
    const command = within(commandGroup).getByRole("button", { name: "Open Studio commands" })

    expect(commandGroup).toHaveClass("mt-auto")
    expect(command).toHaveAttribute("title", "Open Studio commands (⌘/Ctrl Shift K)")
    expect(command).toHaveTextContent("")

    fireEvent.click(command)
    expect(onOpenCommands).toHaveBeenCalledOnce()
  })

  it("exposes selected state and discoverable labels without animated selection", () => {
    renderRail({ selectedTool: "products", collapsed: true })

    const products = screen.getByRole("button", { name: "Products" })
    const layers = screen.getByRole("button", { name: "Layers" })

    expect(products).toHaveAttribute("aria-pressed", "true")
    expect(products).toHaveAttribute("data-selected", "true")
    expect(products).toHaveAttribute("title", "Products — expand tool panel (G then P)")
    expect(products).toHaveClass("transition-none")
    expect(products).not.toHaveClass("transition-all")
    expect(layers).toHaveAttribute("aria-pressed", "false")
    expect(layers).toHaveAttribute("title", "Layers — open tool panel (G then L)")
  })

  it("selects and requests expansion for another tool, then toggles the active tool", () => {
    const onSelectTool = vi.fn()
    const onToggleActiveTool = vi.fn()
    renderRail({ onSelectTool, onToggleActiveTool })

    fireEvent.click(screen.getByRole("button", { name: "Components" }))

    expect(onSelectTool).toHaveBeenCalledOnce()
    expect(onSelectTool).toHaveBeenCalledWith("components")
    expect(onToggleActiveTool).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Layers" }))

    expect(onToggleActiveTool).toHaveBeenCalledOnce()
  })

  it("uses roving tabindex and moves focus with wrapping Arrow, Home, and End keys", () => {
    const onSelectTool = vi.fn()
    const onToggleActiveTool = vi.fn()
    renderRail({ selectedTool: "templates", onSelectTool, onToggleActiveTool })

    const layers = screen.getByRole("button", { name: "Layers" })
    const templates = screen.getByRole("button", { name: "Templates" })
    const designSystem = screen.getByRole("button", { name: "Design System" })
    const products = screen.getByRole("button", { name: "Products" })
    const settings = screen.getByRole("button", { name: "Settings" })

    expect(templates).toHaveAttribute("tabindex", "0")
    expect(layers).toHaveAttribute("tabindex", "-1")

    templates.focus()
    fireEvent.keyDown(templates, { key: "ArrowDown" })
    expect(designSystem).toHaveFocus()
    expect(designSystem).toHaveAttribute("tabindex", "0")

    fireEvent.keyDown(designSystem, { key: "ArrowDown" })
    expect(products).toHaveFocus()

    fireEvent.keyDown(products, { key: "End" })
    expect(settings).toHaveFocus()

    fireEvent.keyDown(settings, { key: "ArrowDown" })
    expect(layers).toHaveFocus()

    fireEvent.keyDown(layers, { key: "ArrowUp" })
    expect(settings).toHaveFocus()

    fireEvent.keyDown(settings, { key: "Home" })
    expect(layers).toHaveFocus()
    expect(onSelectTool).not.toHaveBeenCalled()
    expect(onToggleActiveTool).not.toHaveBeenCalled()
  })
})
