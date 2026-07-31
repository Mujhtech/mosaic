import { describe, expect, it } from "vitest"

import {
  describeReplayRefusal,
  replayComparisonExplanation,
  validateReplayScope,
} from "@/features/billing-projection/types/projection-vocabulary"

/**
 * Two risks are protected here.
 *
 * The first is an unbounded replay. There is deliberately no "replay
 * everything" member in the contract, because an unbounded replay is a
 * migration; a form that lets an operator submit empty bounds turns that
 * design decision into a server-side 422 they have to decode, and — worse — a
 * half-filled fact window is accepted by the shape check while meaning
 * something nobody intended.
 *
 * The second is the unimplemented-rule-version refusal. Rendering it as a
 * generic validation failure loses the only sentence that explains why Mosaic
 * refuses to approximate: a checksum from the wrong engine is
 * indistinguishable from a genuine determinism result.
 */
describe("projection replay scope", () => {
  it("refuses an unbounded replay before it reaches the API", () => {
    expect(validateReplayScope({})).toBe("unbounded")
  })

  it("accepts a single named scope", () => {
    expect(validateReplayScope({ subscriptionInstanceId: "sub_01" })).toBeUndefined()
    expect(validateReplayScope({ billingCustomerId: "cus_01" })).toBeUndefined()
  })

  it("rejects a half-specified or inverted fact window", () => {
    expect(validateReplayScope({ windowStart: "2026-07-01T00:00:00Z" })).toBe("window_incomplete")
    expect(
      validateReplayScope({
        windowEnd: "2026-07-01T00:00:00Z",
        windowStart: "2026-07-02T00:00:00Z",
      }),
    ).toBe("window_inverted")
  })

  it("accepts a complete, ordered fact window", () => {
    expect(
      validateReplayScope({
        windowEnd: "2026-07-02T00:00:00Z",
        windowStart: "2026-07-01T00:00:00Z",
      }),
    ).toBeUndefined()
  })
})

describe("projection replay outcome copy", () => {
  it("explains the unimplemented rule version rather than showing a bare 422", () => {
    const message = describeReplayRefusal({
      code: "unsupported_projection_rule_version",
      status: 422,
    })
    expect(message).toContain("does not derive under the requested projection rule version")
    expect(message).toContain("indistinguishable from a genuine determinism result")
  })

  it("leaves other failures to the ordinary error path", () => {
    expect(describeReplayRefusal({ code: "not_found", status: 404 })).toBeUndefined()
  })

  it("states that an identical replay wrote nothing and a changed one preserved the old snapshot", () => {
    expect(replayComparisonExplanation("unchanged")).toContain("Nothing was written")
    expect(replayComparisonExplanation("changed")).toContain("preserved")
  })
})
