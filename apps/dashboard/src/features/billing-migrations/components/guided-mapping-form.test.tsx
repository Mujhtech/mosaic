import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { GuidedMappingForm } from "@/features/billing-migrations/components/guided-mapping-form"

describe("GuidedMappingForm", () => {
  it("validates structured rows and presents an exact pre-submit review", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<GuidedMappingForm isPending={false} onCreate={onCreate} />)
    expect(screen.getByRole("button", { name: "Review mapping set" })).toBeDisabled()
    expect(screen.getByText("Enter the exact source identifier.")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox", { name: /Source identifier/ }), {
      target: { value: "source.product.pro" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: /Mosaic target ID/ }), {
      target: { value: "product_pro" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Review mapping set" }))
    expect(screen.getByRole("heading", { name: "Review before creating" })).toBeInTheDocument()
    expect(screen.getByText(/source\.product\.pro/)).toBeInTheDocument()
    expect(screen.getByText(/product_pro/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Create reviewed draft" }))
    expect(onCreate).toHaveBeenCalledWith([
      {
        matchKind: "exact",
        sourceIdentifier: "source.product.pro",
        sourceKind: "product",
        targetId: "product_pro",
      },
    ])
  })
})
