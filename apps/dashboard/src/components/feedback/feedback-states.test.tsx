import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { EmptyState } from "@/components/feedback/empty-state"
import { ErrorState } from "@/components/feedback/error-state"
import { LoadingState } from "@/components/feedback/loading-state"
import { Button } from "@/components/ui/button"

describe("feedback states", () => {
  it("announces loading progress without exposing the decorative spinner", () => {
    render(<LoadingState description="Fetching the workspace." title="Loading workspace" />)

    const status = screen.getByRole("status")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveTextContent("Loading workspace")
    expect(status).toHaveTextContent("Fetching the workspace.")
  })

  it("exposes an actionable error alert", () => {
    const retry = vi.fn()
    render(<ErrorState onRetry={retry} />)

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong")
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it("announces an empty result and renders an optional action", () => {
    render(
      <EmptyState
        action={<button type="button">Create one</button>}
        description="Nothing matches the current view."
        title="No results"
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("No results")
    expect(screen.getByRole("button", { name: "Create one" })).toBeEnabled()
  })

  it("keeps the shadcn button wrapper on an accessible Base UI button", () => {
    render(<Button disabled>Unavailable</Button>)

    const button = screen.getByRole("button", { name: "Unavailable" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("data-slot", "button")
  })
})
