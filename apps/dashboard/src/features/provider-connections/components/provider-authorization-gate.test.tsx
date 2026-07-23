import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ProviderAuthorizationGate } from "@/features/provider-connections/components/provider-authorization-gate"

describe("ProviderAuthorizationGate", () => {
  it("does not collect or redisplay a credential while RevenueCat authorization is undecided", () => {
    render(<ProviderAuthorizationGate />)

    expect(
      screen.getByRole("heading", { name: "RevenueCat authorization is not enabled yet" }),
    ).toBeVisible()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/secret|credential|api key/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Connect RevenueCat" })).toBeDisabled()
  })
})
