import { beforeEach, describe, expect, it, vi } from "vitest"

const listValidationAttempts = vi.fn()

vi.mock("@/generated/api", () => ({
  listBillingLedger: vi.fn(),
  listTransactionFacts: vi.fn(),
  listValidationAttempts,
}))

const { transactionKeys, validationAttemptsQueryOptions } =
  await import("@/features/billing-ledger/queries/transaction-queries")

/**
 * Risk: the attempt history is fetched for the whole Mosaic Environment and
 * filtered in the browser. In an Environment with real traffic the attempts
 * belonging to the record an operator opened fall outside that page, and the
 * panel then asserts "no Validation Attempt is recorded against this input" —
 * a factual claim about the audit trail that is wrong, and that contradicts the
 * attempt count rendered directly above it on the quarantine screen.
 *
 * The whole promise of the phase is a preserved, readable attempt history, so a
 * surface that reports "none" when three exist is worse than showing nothing.
 */
describe("validation attempt scoping", () => {
  beforeEach(() => {
    listValidationAttempts.mockReset()
    listValidationAttempts.mockResolvedValue({ data: { data: { items: [] } } })
  })

  it("asks the API for one input's attempts rather than filtering a page in the browser", async () => {
    const options = validationAttemptsQueryOptions("proj_1", "env_1", "rawin_42")
    await options.queryFn!({ signal: new AbortController().signal } as never)

    const [request] = listValidationAttempts.mock.calls[0] ?? []
    expect(request.query.rawInputId).toBe("rawin_42")
    expect(request.path).toEqual({ environmentId: "env_1", projectId: "proj_1" })
  })

  it("caches each input's history separately, so one record cannot answer for another", () => {
    expect(transactionKeys.attempts("proj_1", "env_1", "rawin_42")).not.toEqual(
      transactionKeys.attempts("proj_1", "env_1", "rawin_43"),
    )
    // The scope key still covers both, so a replay invalidates every input's
    // history rather than only the one the mutation named.
    const scope = transactionKeys.attemptsScope("proj_1", "env_1")
    expect(transactionKeys.attempts("proj_1", "env_1", "rawin_42").slice(0, scope.length)).toEqual([
      ...scope,
    ])
  })
})
