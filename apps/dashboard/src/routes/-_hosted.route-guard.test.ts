import { QueryClient } from "@tanstack/react-query"
import { isRedirect } from "@tanstack/react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, ApiNetworkError } from "@/lib/api/errors"

/**
 * Hosted routes shipped unguarded: an unauthenticated visitor reached the
 * workspace shell and saw a wall of 401 panels instead of the sign-in page.
 * The guard must also not become an open redirect through `returnTo`, and must
 * not lock an operator out when the API is merely unreachable.
 *
 * The generated SDK call is stubbed rather than the network, because the client
 * captures `globalThis.fetch` when it is constructed.
 */
const getSession = vi.hoisted(() => vi.fn())

vi.mock("@/generated/api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/generated/api/sdk.gen")>()),
  getSession,
}))

const { Route } = await import("@/routes/_hosted")

const unauthenticated = () =>
  Promise.reject(
    new ApiError("no session", {
      code: "unauthenticated",
      correlationId: "request_test",
      retryable: false,
      status: 401,
    }),
  )

const authenticated = () =>
  Promise.resolve({ data: { data: { email: "operator@example.test", id: "actor_01" } } })

const unreachable = () =>
  Promise.reject(new ApiNetworkError("request_offline", new TypeError("Failed to fetch")))

beforeEach(() => {
  getSession.mockReset()
})

async function runGuard(respond: () => Promise<unknown>, href: string) {
  getSession.mockImplementation(respond)

  const beforeLoad = Route.options.beforeLoad
  if (!beforeLoad) throw new Error("The hosted layout route has no beforeLoad guard.")

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  try {
    // Only `context` and `location.href` are read by the guard.
    await (beforeLoad as (args: unknown) => Promise<void>)({
      context: { queryClient },
      location: { href },
    })
    return null
  } catch (thrown) {
    return thrown
  }
}

describe("hosted route guard", () => {
  it("redirects an unauthenticated visitor to sign-in with the requested path", async () => {
    const thrown = await runGuard(unauthenticated, "/orgs/org_01/projects/project_01")

    expect(isRedirect(thrown)).toBe(true)
    expect(thrown).toMatchObject({
      options: {
        search: { returnTo: "/orgs/org_01/projects/project_01" },
        to: "/login",
      },
    })
  })

  it("never carries an external destination into returnTo", async () => {
    for (const hostile of [
      "https://attacker.example/steal",
      "//attacker.example/steal",
      "/\\attacker.example/steal",
    ]) {
      const thrown = await runGuard(unauthenticated, hostile)

      expect(isRedirect(thrown)).toBe(true)
      // safeInternalReturnTo rejects the value, and an absent returnTo lets the
      // sign-in flow fall back to its own safe default.
      expect(thrown).toMatchObject({ options: { search: {} } })
    }
  })

  it("lets the shell render when the session request fails for a transport reason", async () => {
    // A degraded API must not sign the operator out; the per-resource
    // boundaries report the outage instead.
    expect(await runGuard(unreachable, "/workspace")).toBeNull()
  })

  it("does not redirect an authenticated operator", async () => {
    expect(await runGuard(authenticated, "/workspace")).toBeNull()
  })
})
