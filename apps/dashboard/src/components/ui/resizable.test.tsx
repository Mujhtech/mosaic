import { createRef } from "react"
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import type {
  ResizableGroupImperativeHandle,
  ResizablePanelImperativeHandle,
} from "@/components/ui/resizable"

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

describe("Resizable", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverStub))
  afterEach(() => vi.unstubAllGlobals())

  it("preserves the upstream separator and keyboard semantics", () => {
    const groupRef = createRef<ResizableGroupImperativeHandle>()
    const panelRef = createRef<ResizablePanelImperativeHandle>()

    render(
      <ResizablePanelGroup groupRef={groupRef} orientation="horizontal">
        <ResizablePanel id="left-panel" defaultSize="50%" panelRef={panelRef}>
          Left panel
        </ResizablePanel>
        <ResizableHandle id="workspace-handle" aria-label="Resize workspace panels" withHandle />
        <ResizablePanel id="right-panel" defaultSize="50%">
          Right panel
        </ResizablePanel>
      </ResizablePanelGroup>,
    )

    const separator = screen.getByRole("separator", { name: "Resize workspace panels" })
    expect(separator).toHaveAttribute("aria-orientation", "vertical")
    expect(separator).toHaveAttribute("tabindex", "0")
    expect(separator).toHaveAttribute("data-slot", "resizable-handle")
    expect(separator.firstElementChild).toHaveClass("h-6", "w-3", "bg-background")
    expect(separator.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    separator.focus()
    expect(separator).toHaveFocus()

    expect(screen.getByText("Left panel").parentElement).toHaveAttribute(
      "data-slot",
      "resizable-panel",
    )
    expect(screen.getByText("Right panel").parentElement).toHaveAttribute(
      "data-slot",
      "resizable-panel",
    )
    expect(groupRef.current).toEqual(
      expect.objectContaining({ getLayout: expect.any(Function), setLayout: expect.any(Function) }),
    )
    expect(panelRef.current).toEqual(
      expect.objectContaining({
        collapse: expect.any(Function),
        expand: expect.any(Function),
        getSize: expect.any(Function),
        isCollapsed: expect.any(Function),
        resize: expect.any(Function),
      }),
    )
  })
})
