import { describe, expect, it } from "vitest"

import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { ApiError, ApiNetworkError } from "@/lib/api/errors"

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

  it("classifies a transport failure as degraded rather than a server error", () => {
    const state = resolveHostedQueryState({
      ...baseOptions,
      error: new ApiNetworkError("request_offline", new TypeError("Failed to fetch")),
    })

    expect(state).toMatchObject({ kind: "degraded", requestId: "request_offline" })
  })

  /**
   * The drill found the shell answering an actionable, coded failure with the
   * generic status-family copy ("This resource changed since it was loaded"),
   * which sends an operator to reload instead of to the page that resolves the
   * condition. These cases pin the code map ahead of the status fallback, the
   * recovery destination, and the rendered server details.
   */
  describe("coded failures", () => {
    const scope = {
      environmentId: "env_prod",
      organizationId: "org_01",
      projectId: "project_01",
    }

    function codedError(code: string, status: number, details?: unknown) {
      return new ApiError("server prose", {
        code,
        correlationId: "request_coded",
        details,
        retryable: false,
        status,
      })
    }

    it("explains an unbound Placement and links to Placements instead of reporting a stale conflict", () => {
      const state = resolveHostedQueryState({
        ...baseOptions,
        error: codedError("placement_unpublished", 409),
        scope,
      })

      expect(state).toMatchObject({
        kind: "error",
        recovery: {
          href: "/orgs/org_01/projects/project_01/monetization/env_prod/placements",
          label: "Review Placements",
        },
      })
      const description = "description" in state ? state.description : ""
      expect(description).toContain("isn't bound to a Placement")
      expect(description).not.toContain("changed since it was loaded")
    })

    it("renders the 406 capability details so the failed requirement is actionable", () => {
      const state = resolveHostedQueryState({
        ...baseOptions,
        error: codedError("unsupported_capability", 406, {
          capability: "Mosaic-Paywall-Capabilities",
          reason: "malformed",
          requirement: "configurationDeliveryVersion",
          version: "1",
        }),
        scope,
      })

      expect(state.kind).toBe("error")
      const details = "details" in state ? state.details : undefined
      expect(details).toEqual([
        { label: "Requirement", value: "configurationDeliveryVersion" },
        { label: "Capability", value: "Mosaic-Paywall-Capabilities" },
        { label: "Version", value: "1" },
        { label: "Reason", value: "malformed" },
      ])
      const description = "description" in state ? state.description : ""
      expect(description).not.toContain("server prose")
    })

    it("points a disabled analytics Environment at Environment settings", () => {
      const state = resolveHostedQueryState({
        ...baseOptions,
        error: codedError("analytics_collection_disabled", 409),
        scope,
      })

      expect(state).toMatchObject({
        kind: "error",
        recovery: {
          href: "/orgs/org_01/projects/project_01/settings/environments",
          label: "Open Environment settings",
        },
      })
    })

    it("renders the readiness blockers the server reported", () => {
      const state = resolveHostedQueryState({
        ...baseOptions,
        error: codedError("provider_readiness_unavailable", 409, {
          blockers: [
            { code: "mappingMissing", productId: "product_01" },
            { code: "connectionRevoked" },
          ],
        }),
        scope,
      })

      expect(state).toMatchObject({
        details: [
          { label: "Product product_01", value: "mappingMissing" },
          { value: "connectionRevoked" },
        ],
        kind: "error",
      })
    })

    it("renders the rejected validation fields", () => {
      const state = resolveHostedQueryState({
        ...baseOptions,
        error: codedError("validation_failed", 422, {
          fields: { key: ["must be lowercase", "must be unique"] },
        }),
        scope,
      })

      expect(state).toMatchObject({
        details: [{ label: "key", value: "must be lowercase, must be unique" }],
        kind: "error",
      })
    })

    it("keeps the conflict fallback for a genuinely stale 409", () => {
      const state = resolveHostedQueryState({
        ...baseOptions,
        error: codedError("conflict", 409),
        scope,
      })

      expect(state).toMatchObject({
        description: "This resource changed since it was loaded. Reload and try again.",
        kind: "error",
      })
      expect(state).not.toHaveProperty("recovery")
    })

    it("keeps the specific explanation when no scope identifiers are available", () => {
      // Studio and other pre-scope surfaces call this without a project; only
      // the link may be dropped, never the explanation.
      const state = resolveHostedQueryState({
        ...baseOptions,
        error: codedError("placement_unpublished", 409),
      })

      const description = "description" in state ? state.description : ""
      expect(description).toContain("isn't bound to a Placement")
      expect(state).toMatchObject({ recovery: { label: "Review Placements" } })
      expect("recovery" in state ? state.recovery?.href : "unset").toBeUndefined()
    })
  })

  it("never renders the raw server message", () => {
    const leaky = new ApiError('pq: relation "organizations" does not exist', {
      code: "internal_error",
      correlationId: "request_leak",
      retryable: true,
      status: 500,
    })

    const state = resolveHostedQueryState({ ...baseOptions, error: leaky })

    expect(state.kind).toBe("error")
    const description = "description" in state ? state.description : undefined
    expect(description).toBeDefined()
    expect(description).not.toContain("relation")
    expect(description).not.toContain("pq:")
  })
})
