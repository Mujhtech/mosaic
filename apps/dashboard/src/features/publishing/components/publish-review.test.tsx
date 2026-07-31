import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { PublishReview } from "@/features/publishing/components/publish-review"
import { MOCK_PRODUCT_ACKNOWLEDGEMENT_CODE } from "@/features/publishing/api/hosted-publishing-adapter"

describe("PublishReview", () => {
  it("blocks publication and links to recovery when validation has an error", () => {
    const onPublish = vi.fn()
    render(
      <PublishReview
        acknowledgeMockProducts={false}
        environmentLabel="Staging"
        isPublishing={false}
        onAcknowledgeMockProductsChange={vi.fn()}
        onPublish={onPublish}
        revision={8}
        validation={{
          assets: [],
          issues: [
            {
              code: "product.missing",
              message: "Monthly is missing from this Project.",
              recoveryHref: "/orgs/org/projects/project/catalog/products",
              severity: "error",
            },
          ],
          placements: [],
          products: [],
          protocolVersion: "0.2",
        }}
      />,
    )

    expect(screen.getByRole("button", { name: "Publish to Staging" })).toBeDisabled()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Resolve issue" })).toHaveAttribute(
      "href",
      "/orgs/org/projects/project/catalog/products",
    )
    fireEvent.click(screen.getByRole("button", { name: "Publish to Staging" }))
    expect(onPublish).not.toHaveBeenCalled()
  })

  it("requires explicit acknowledgement before publishing with mock product warnings", () => {
    const onAcknowledgeMockProductsChange = vi.fn()
    const onPublish = vi.fn()
    const { rerender } = render(
      <PublishReview
        acknowledgeMockProducts={false}
        environmentLabel="Staging"
        isPublishing={false}
        onAcknowledgeMockProductsChange={onAcknowledgeMockProductsChange}
        onPublish={onPublish}
        revision={8}
        validation={{
          assets: [],
          issues: [
            {
              code: MOCK_PRODUCT_ACKNOWLEDGEMENT_CODE,
              message: "Monthly uses mock product metadata.",
              severity: "warning",
            },
          ],
          placements: [],
          products: [{ id: "product_01", name: "Monthly", ready: false }],
          protocolVersion: "0.2",
        }}
      />,
    )

    const acknowledgement = screen.getByRole("checkbox", {
      name: /I understand these products still use mock metadata/,
    })
    expect(screen.getByRole("button", { name: "Publish to Staging" })).toBeDisabled()
    fireEvent.click(acknowledgement)
    expect(onAcknowledgeMockProductsChange).toHaveBeenCalledWith(true)

    rerender(
      <PublishReview
        acknowledgeMockProducts
        environmentLabel="Staging"
        isPublishing={false}
        onAcknowledgeMockProductsChange={onAcknowledgeMockProductsChange}
        onPublish={onPublish}
        revision={8}
        validation={{
          assets: [],
          issues: [
            {
              code: MOCK_PRODUCT_ACKNOWLEDGEMENT_CODE,
              message: "Monthly uses mock product metadata.",
              severity: "warning",
            },
          ],
          placements: [],
          products: [{ id: "product_01", name: "Monthly", ready: false }],
          protocolVersion: "0.2",
        }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Publish to Staging" }))
    expect(onPublish).toHaveBeenCalledOnce()
  })
})
