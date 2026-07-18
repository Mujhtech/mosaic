import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  StudioToolbar,
  type StudioToolbarProps,
} from "@/features/paywall-editor/components/studio-toolbar"

function toolbarProps(overrides: Partial<StudioToolbarProps> = {}): StudioToolbarProps {
  return {
    autosave: { status: "saved", flush: vi.fn(() => true), retry: vi.fn() },
    canRedo: false,
    canUndo: true,
    documentIdentity: "focused-offer_v2",
    previewClientCount: 2,
    previewSummary: "2 of 2 previews updated",
    onBack: vi.fn(() => true),
    onExport: vi.fn(),
    onOpenPreviewConnections: vi.fn(),
    onRedo: vi.fn(),
    onRequestImport: vi.fn(),
    onUndo: vi.fn(),
    ...overrides,
  }
}

describe("StudioToolbar", () => {
  it("humanizes a read-only document identity and exposes the dedicated Studio actions", () => {
    const props = toolbarProps()
    render(<StudioToolbar {...props} />)

    expect(screen.getByRole("link", { name: "Back to Foundation" })).toHaveAttribute(
      "href",
      "/foundation",
    )
    expect(screen.getByRole("heading", { name: "Focused offer v2" })).toBeVisible()
    expect(screen.getByText("Saved locally")).toBeVisible()
    expect(screen.getByText(/Preview clients/)).toHaveTextContent("Preview clients · 2")
    expect(screen.getByRole("button", { name: "Open connected previews" })).toHaveAttribute(
      "aria-controls",
      "connected-preview-panel",
    )
    expect(screen.getByRole("button", { name: "Open connected previews" })).toHaveAttribute(
      "title",
      "2 of 2 previews updated",
    )
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Toggle properties" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open templates" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Toggle diagnostics" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    fireEvent.click(screen.getByRole("button", { name: "Open connected previews" }))
    fireEvent.click(screen.getByRole("button", { name: "Export" }))

    expect(props.onUndo).toHaveBeenCalledOnce()
    expect(props.onOpenPreviewConnections).toHaveBeenCalledOnce()
    expect(props.onExport).toHaveBeenCalledOnce()
    expect(screen.queryByRole("button", { name: "Open Studio commands" })).not.toBeInTheDocument()
  })

  it("supports local import and the exact failed autosave recovery action", () => {
    const retry = vi.fn()
    const onRequestImport = vi.fn()
    render(
      <StudioToolbar
        {...toolbarProps({
          autosave: { status: "failed", flush: vi.fn(() => false), retry },
          onRequestImport,
        })}
      />,
    )

    expect(screen.getByText("Autosave failed")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(retry).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole("button", { name: "Import Mosaic JSON" }))
    expect(onRequestImport).toHaveBeenCalledOnce()
  })

  it("allows Back only after a synchronous pending autosave flush succeeds", () => {
    const flush = vi.fn(() => false)
    const { rerender } = render(
      <StudioToolbar
        {...toolbarProps({
          autosave: { status: "saving", flush, retry: vi.fn() },
          onBack: flush,
        })}
      />,
    )
    const blockedEvent = new MouseEvent("click", { bubbles: true, cancelable: true })
    fireEvent(screen.getByRole("link", { name: "Back to Foundation" }), blockedEvent)
    expect(flush).toHaveBeenCalledOnce()
    expect(blockedEvent.defaultPrevented).toBe(true)

    const successfulFlush = vi.fn(() => true)
    rerender(
      <StudioToolbar
        {...toolbarProps({
          autosave: { status: "saving", flush: successfulFlush, retry: vi.fn() },
          onBack: successfulFlush,
        })}
      />,
    )
    const allowedEvent = new MouseEvent("click", { bubbles: true, cancelable: true })
    fireEvent(screen.getByRole("link", { name: "Back to Foundation" }), allowedEvent)
    expect(successfulFlush).toHaveBeenCalledOnce()
    expect(allowedEvent.defaultPrevented).toBe(false)
  })

  it("uses stable fallback text for blank identities", () => {
    const { rerender } = render(<StudioToolbar {...toolbarProps({ documentIdentity: "   " })} />)
    expect(screen.getByRole("heading", { name: "Untitled paywall" })).toBeVisible()

    rerender(<StudioToolbar {...toolbarProps({ documentIdentity: "benefitsFirst-paywall" })} />)
    expect(screen.getByRole("heading", { name: "Benefits First paywall" })).toBeVisible()
  })

  it("keeps the zero-client status compact and fully visible", () => {
    render(
      <StudioToolbar
        {...toolbarProps({
          previewClientCount: 0,
          previewSummary: "No native previews connected",
        })}
      />,
    )

    const label = screen.getByText(/Preview clients/)
    expect(label).toHaveTextContent("Preview clients · 0")
    expect(label).not.toHaveClass("truncate")
  })
})
