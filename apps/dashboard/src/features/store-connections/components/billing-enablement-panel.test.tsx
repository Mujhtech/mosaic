import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BillingEnablementPanel } from "@/features/store-connections/components/billing-enablement-panel"
import { ApiError } from "@/lib/api/errors"

/**
 * Risk: the only control that starts the phase's primary workflow either fails
 * silently or fails uninformatively.
 *
 * Two failure shapes matter. A refusal to disable while credentials are active
 * is a documented, recoverable condition with one specific next step (revoke
 * first), and rendering it as a bare server message would leave the operator
 * with no idea what to do. And an unreadable enablement state must never be
 * presented as "off", because that would invite an operator to "turn on"
 * billing that is already on, or to conclude their setup failed when it did not.
 */

function credentialsStillActive() {
  return new ApiError("Store credentials are still active.", {
    code: "store_credentials_still_active",
    correlationId: "req_fixture_1",
    retryable: false,
    status: 409,
  })
}

function renderPanel(overrides: Partial<Parameters<typeof BillingEnablementPanel>[0]> = {}) {
  return render(
    <BillingEnablementPanel
      activeCredentialCount={2}
      billingEnabled
      canManage
      error={null}
      isPending={false}
      isSaving={false}
      membersHref="/organizations/org_1/members"
      onChange={vi.fn()}
      {...overrides}
    />,
  )
}

describe("Mosaic Billing enablement control", () => {
  it("explains the 409 refusal and names revoking the credentials as the next step", () => {
    renderPanel({ error: credentialsStillActive() })

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Revoke the active Store Server Credentials first/,
    )
    // The reason matters: disabling alone does not stop Apple posting, and each
    // refusal spends one of five non-renewable delivery attempts.
    expect(screen.getByRole("alert")).toHaveTextContent(/non-renewable delivery attempts/)
    // The raw server message is never surfaced in place of Mosaic-owned copy.
    expect(screen.queryByText("Store credentials are still active.")).not.toBeInTheDocument()
  })

  it("falls back to a generic failure for an error it has no specific remedy for", () => {
    renderPanel({ error: new Error("boom") })

    expect(screen.getByRole("alert")).toHaveTextContent("boom")
    expect(
      screen.queryByText(/Revoke the active Store Server Credentials first/),
    ).not.toBeInTheDocument()
  })

  it("never reports an unreadable state as disabled", () => {
    renderPanel({ billingEnabled: null })

    expect(screen.getByText("State unavailable")).toBeVisible()
    expect(screen.queryByText("Not enabled")).not.toBeInTheDocument()
    // No enable button, because Mosaic does not know what it would be changing.
    expect(screen.queryByRole("button", { name: /Turn on Mosaic Billing/ })).not.toBeInTheDocument()
  })

  it("offers turning billing on as the primary step when it is off", () => {
    const onChange = vi.fn()
    renderPanel({ billingEnabled: false, onChange })

    screen.getByRole("button", { name: "Turn on Mosaic Billing" }).click()
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("hides the controls from an actor who cannot manage the Organization", () => {
    renderPanel({ billingEnabled: false, canManage: false })

    expect(screen.queryByRole("button", { name: /Turn on Mosaic Billing/ })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Ask an Owner or Admin" })).toBeVisible()
  })
})
