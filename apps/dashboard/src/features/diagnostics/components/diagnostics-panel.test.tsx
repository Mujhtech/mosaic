import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/api/errors"

/**
 * Diagnostics used to sit behind the hosted authentication guard, so the one
 * page that reports which bundle is loaded and which API it targets was
 * unreachable in exactly the situation it exists for: a failing sign-in. The
 * page holds no tenant data, so it must render while signed out.
 *
 * The generated SDK calls are stubbed rather than the network, because the
 * client captures `globalThis.fetch` when it is constructed.
 */
const getSession = vi.hoisted(() => vi.fn())

vi.mock("@/generated/api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/generated/api/sdk.gen")>()),
  getSession,
}))

const { DiagnosticsPanel } = await import("@/features/diagnostics/components/diagnostics-panel")
const { Route } = await import("@/routes/diagnostics")

describe("diagnostics availability", () => {
  it("reports build identity and configuration while signed out", async () => {
    getSession.mockRejectedValue(
      new ApiError("no session", {
        code: "unauthenticated",
        correlationId: "request_test",
        retryable: false,
        status: 401,
      }),
    )

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DiagnosticsPanel />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText("Not signed in")).toBeVisible())
    expect(screen.getByText("0.0.0-test")).toBeVisible()
    expect(screen.getByText("Dashboard version")).toBeVisible()
    expect(screen.getByText("API base URL")).toBeVisible()
    // A 401 is the expected state here, not a failure to report.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("is not mounted under the hosted authentication guard", () => {
    // File-based routing means the directory decides the guard: the redirect
    // lives on the `_hosted` layout route, so a diagnostics route file placed
    // under `routes/_hosted/` would silently become unreachable while signed
    // out again.
    const routes = resolve(process.cwd(), "src/routes")
    expect(existsSync(resolve(routes, "diagnostics.tsx"))).toBe(true)
    expect(existsSync(resolve(routes, "_hosted/diagnostics.tsx"))).toBe(false)
    expect(Route.options.beforeLoad).toBeUndefined()
  })
})
