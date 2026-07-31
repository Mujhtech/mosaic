import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ResizableGroupImperativeHandle,
  ResizablePanelImperativeHandle,
} from "@/components/ui/resizable";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

describe("Resizable", () => {
  beforeEach(() => vi.stubGlobal("ResizeObserver", ResizeObserverStub));
  afterEach(() => vi.unstubAllGlobals());

  it("preserves the upstream separator and keyboard semantics", () => {
    const groupRef = createRef<ResizableGroupImperativeHandle>();
    const panelRef = createRef<ResizablePanelImperativeHandle>();

    render(
      <ResizablePanelGroup groupRef={groupRef} orientation="horizontal">
        <ResizablePanel defaultSize="50%" id="left-panel" panelRef={panelRef}>
          Left panel
        </ResizablePanel>
        <ResizableHandle
          aria-label="Resize workspace panels"
          id="workspace-handle"
          withHandle
        />
        <ResizablePanel defaultSize="50%" id="right-panel">
          Right panel
        </ResizablePanel>
      </ResizablePanelGroup>
    );

    const separator = screen.getByRole("separator", {
      name: "Resize workspace panels",
    });
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("tabindex", "0");
    expect(separator).toHaveAttribute("data-slot", "resizable-handle");
    expect(separator.firstElementChild).toHaveClass(
      "h-6",
      "w-3",
      "bg-background"
    );
    expect(separator.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    separator.focus();
    expect(separator).toHaveFocus();

    expect(screen.getByText("Left panel").parentElement).toHaveAttribute(
      "data-slot",
      "resizable-panel"
    );
    expect(screen.getByText("Right panel").parentElement).toHaveAttribute(
      "data-slot",
      "resizable-panel"
    );
    expect(groupRef.current).toEqual(
      expect.objectContaining({
        getLayout: expect.any(Function),
        setLayout: expect.any(Function),
      })
    );
    expect(panelRef.current).toEqual(
      expect.objectContaining({
        collapse: expect.any(Function),
        expand: expect.any(Function),
        getSize: expect.any(Function),
        isCollapsed: expect.any(Function),
        resize: expect.any(Function),
      })
    );
  });
});
