import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ConflictResolutionForm } from "@/features/billing-customers/components/conflict-resolution-form"
import type { ResolveIdentityConflictRequest } from "@/generated/api"

type ResolveFn = (request: ResolveIdentityConflictRequest) => Promise<void>

function renderForm(onResolve: ResolveFn = async () => undefined) {
  const spy = vi.fn<ResolveFn>(onResolve)
  render(
    <ConflictResolutionForm
      canManage
      firstCustomerId="cus_incumbent"
      membersHref="/orgs/org_01/members"
      onResolve={spy}
      secondCustomerId="cus_challenger"
    />,
  )
  return spy
}

const submitName = /Record this resolution/

/**
 * The wiring the pure gate cannot cover: that the form actually consumes it,
 * and that there is no path through the markup that submits a resolution on a
 * single click.
 */
describe("conflict resolution form", () => {
  it("offers no single-action merge and no preselected resolution", () => {
    renderForm()

    // Nothing is chosen for the operator. A default selection is a
    // recommendation, and Mosaic has deliberately not chosen a winner.
    for (const label of [
      "Keep the existing customer",
      "Reassign to the candidate",
      "Split — neither claim wins",
    ]) {
      expect(screen.getByRole("radio", { name: label })).not.toBeChecked()
    }
    expect(screen.queryByRole("button", { name: /merge/i })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: submitName })).toBeDisabled()
  })

  it("keeps submission disabled until the reason and the acknowledgement are both given", async () => {
    const resolve = renderForm()

    fireEvent.click(screen.getByRole("radio", { name: "Reassign to the candidate" }))
    // The consequence for BOTH parties appears as soon as a choice is made.
    expect(screen.getByText(/lose the access it grants/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: submitName })).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Reason for this resolution/), {
      target: { value: "Ticket 4821 confirmed the challenger owns the store account." },
    })
    expect(screen.getByRole("button", { name: submitName })).toBeDisabled()

    fireEvent.click(screen.getByRole("checkbox"))
    await waitFor(() => expect(screen.getByRole("button", { name: submitName })).not.toBeDisabled())

    fireEvent.click(screen.getByRole("button", { name: submitName }))
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1))
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({
      action: "reassign_to_candidate",
      assignedBillingCustomerId: "cus_challenger",
    })
  })

  it("withdraws the acknowledgement when the chosen resolution changes", async () => {
    renderForm()

    fireEvent.click(screen.getByRole("radio", { name: "Reassign to the candidate" }))
    fireEvent.change(screen.getByLabelText(/Reason for this resolution/), {
      target: { value: "Ticket 4821." },
    })
    fireEvent.click(screen.getByRole("checkbox"))
    await waitFor(() => expect(screen.getByRole("button", { name: submitName })).not.toBeDisabled())

    // The acknowledgement was given for a different consequence than the one
    // now selected, so it cannot carry over.
    fireEvent.click(screen.getByRole("radio", { name: "Split — neither claim wins" }))
    expect(screen.getByRole("checkbox")).not.toBeChecked()
    expect(screen.getByRole("button", { name: submitName })).toBeDisabled()
  })

  it("routes an operator without permission to the members page instead of the form", () => {
    render(
      <ConflictResolutionForm
        canManage={false}
        firstCustomerId="cus_incumbent"
        membersHref="/orgs/org_01/members"
        onResolve={async () => undefined}
        secondCustomerId="cus_challenger"
      />,
    )

    expect(screen.queryByRole("button", { name: submitName })).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Ask an Owner or Admin to resolve this conflict" }),
    ).toHaveAttribute("href", "/orgs/org_01/members")
  })
})
