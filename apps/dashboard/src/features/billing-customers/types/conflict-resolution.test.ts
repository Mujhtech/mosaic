import { describe, expect, it } from "vitest"

import {
  conflictActionConsequence,
  conflictActions,
  evaluateResolutionGate,
  expectedAssignee,
} from "@/features/billing-customers/types/conflict-resolution"

const base = {
  acknowledged: true,
  action: "reassign_to_candidate",
  canManage: true,
  firstCustomerId: "cus_incumbent",
  isSubmitting: false,
  reason: "Support ticket 4821 confirmed the challenger owns the store account.",
  secondCustomerId: "cus_challenger",
}

/**
 * Resolving an identity conflict moves real purchases between real people and
 * cannot be undone by re-running it, so the guard is what stands between an
 * operator and an irreversible mistake made in one click.
 *
 * The realistic failure is a form that submits on the radio selection alone —
 * the operator picks "reassign", never reads what happens to the incumbent, and
 * a paying customer loses access with nothing recorded about why.
 */
describe("identity conflict resolution gate", () => {
  it("refuses to submit until an action, a reason, and an acknowledgement are all present", () => {
    expect(evaluateResolutionGate({ ...base, action: undefined }).blockedBy).toBe("action_required")
    expect(evaluateResolutionGate({ ...base, reason: "   " }).blockedBy).toBe("reason_required")
    expect(evaluateResolutionGate({ ...base, acknowledged: false }).blockedBy).toBe(
      "acknowledgement_required",
    )
  })

  it("allows submission only when every condition holds at once", () => {
    expect(evaluateResolutionGate(base).allowed).toBe(true)
  })

  it("requires management permission", () => {
    expect(evaluateResolutionGate({ ...base, canManage: false }).blockedBy).toBe("no_permission")
  })

  it("refuses a resolution whose stated winner contradicts its action", () => {
    // The server enforces this; catching it here keeps the refusal next to the
    // control that caused it rather than surfacing as a 422.
    const gate = evaluateResolutionGate({
      ...base,
      action: "keep_existing",
      assignedBillingCustomerId: "cus_challenger",
    })
    expect(gate.allowed).toBe(false)
    expect(gate.blockedBy).toBe("assignment_mismatch")
  })

  it("derives the assignee the action implies, and none for a split", () => {
    expect(
      expectedAssignee({
        action: "keep_existing",
        firstCustomerId: "cus_incumbent",
        secondCustomerId: "cus_challenger",
      }),
    ).toBe("cus_incumbent")
    expect(
      expectedAssignee({
        action: "reassign_to_candidate",
        firstCustomerId: "cus_incumbent",
        secondCustomerId: "cus_challenger",
      }),
    ).toBe("cus_challenger")
    expect(
      expectedAssignee({
        action: "operator_split",
        firstCustomerId: "cus_incumbent",
        secondCustomerId: "cus_challenger",
      }),
    ).toBeUndefined()
  })
})

describe("resolution consequences", () => {
  it("states the outcome for both parties on every action", () => {
    // The failure this guards is an operator reading only the outcome for the
    // customer in front of them and not noticing the other one loses access.
    for (const action of conflictActions) {
      const sentence = conflictActionConsequence(action)
      expect(sentence.length).toBeGreaterThan(80)
      expect(sentence.toLowerCase()).toContain("access")
    }
    expect(conflictActionConsequence("reassign_to_candidate")).toContain("lose the access")
    expect(conflictActionConsequence("operator_split")).toContain("Neither customer")
  })

  it("offers no action that merges the two customers", () => {
    // Automatic merge stays an architecture checkpoint, not a dashboard button.
    expect(conflictActions).toEqual(["keep_existing", "reassign_to_candidate", "operator_split"])
    expect(conflictActions).not.toContain("merge")
  })
})
