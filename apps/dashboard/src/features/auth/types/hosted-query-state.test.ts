import { describe, expect, it } from "vitest"

import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { ApiError } from "@/lib/api/errors"

function queryError(status: number) {
  return new ApiError("Hosted request failed", {
    code: status === 401 ? "unauthenticated" : "forbidden",
    correlationId: "request_test",
    retryable: false,
    status,
  })
}

const baseOptions = {
  emptyDescription: "Nothing here",
  emptyTitle: "Empty",
  isEmpty: false,
  isPending: false,
  loadingDescription: "Loading",
  permissionDescription: "Owner or admin permission is required.",
}

describe("hosted query recovery state", () => {
  it("keeps an unauthenticated response distinct from a permission failure", () => {
    expect(resolveHostedQueryState({ ...baseOptions, error: queryError(401) })).toEqual({
      kind: "decision_required",
    })
    expect(resolveHostedQueryState({ ...baseOptions, error: queryError(403) })).toEqual({
      description: "Owner or admin permission is required.",
      kind: "permission",
    })
  })

  it("preserves the request ID for recoverable hosted failures", () => {
    const state = resolveHostedQueryState({ ...baseOptions, error: queryError(500) })

    expect(state).toMatchObject({ kind: "error", requestId: "request_test" })
  })
})
