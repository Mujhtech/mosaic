import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { resetActiveEnvironmentStore } from "@/features/environments/types/active-environment-store"

import { SidebarProvider } from "@/components/ui/sidebar"
import type { Environment } from "@/generated/api"
import { EnvironmentSwitcher } from "@/features/environments/components/environment-switcher"
import { environmentKeys } from "@/features/environments/queries/environments-query"
import { ApiError } from "@/lib/api/errors"

// The sidebar reads a media query jsdom does not implement.
beforeAll(() => {
  if (typeof window.matchMedia === "function") return
  window.matchMedia = (query: string) =>
    ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }) as MediaQueryList
})

const timestamps = { createdAt: "2026-07-30T00:00:00Z", updatedAt: "2026-07-30T00:00:00Z" }

function environment(id: string, name: string, mode: Environment["mode"]): Environment {
  return { ...timestamps, id, key: name.toLowerCase(), mode, name, projectId: "prj_01" }
}

const development = environment("env_dev", "Development", "development")
const production = environment("env_prod", "Production", "production")

const PATHS = [
  "/orgs/$organizationId",
  "/orgs/$organizationId/projects/$projectId/env/$environmentKey",
  "/orgs/$organizationId/projects/$projectId/env/$environmentKey/apps",
  "/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/products",
  "/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls",
  "/orgs/$organizationId/projects/$projectId/env/$environmentKey/analytics/$surface",
  "/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/health",
  "/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/connections/$credentialId",
] as const

function renderSwitcher(queryClient: QueryClient, pathname: string) {
  const rootRoute = createRootRoute()
  const routeTree = rootRoute.addChildren(
    PATHS.map((path) =>
      createRoute({
        component: EnvironmentSwitcher,
        getParentRoute: () => rootRoute,
        path,
      }),
    ),
  )

  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [pathname] }),
    routeTree,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RouterProvider router={router} />
      </SidebarProvider>
    </QueryClientProvider>,
  )
}

function seededClient(seed: (client: QueryClient) => void) {
  // staleTime keeps a remount from refetching seeded data against a server that
  // is not there, which would land the switcher in its error branch.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  seed(client)
  return client
}

function withEnvironments(items: Environment[]) {
  return (client: QueryClient) => {
    client.setQueryData(environmentKeys.list("prj_01"), { items, page: { nextCursor: "" } })
  }
}

afterEach(() => {
  // The remembered Environment outlives a render by design; leaking it between
  // cases would let one test decide another's default.
  resetActiveEnvironmentStore()
  window.localStorage.clear()
})

/**
 * One switcher replaces the per-page selects, so it has to hold the invariant they
 * each held locally: switching keeps the operator on the surface they were reading,
 * search included. It also has to be honest about whether the Environment it names
 * is in the address, because only then will a shared link reproduce it.
 */
describe("EnvironmentSwitcher", () => {
  it("switches Environment without leaving the surface", async () => {
    const client = seededClient(withEnvironments([development, production]))

    renderSwitcher(client, "/orgs/org_01/projects/prj_01/monetization/env_dev/paywalls")

    fireEvent.click(
      await screen.findByRole("button", { name: /Current environment: Development, development/ }),
    )

    expect(await screen.findByRole("menuitem", { name: /Production/ })).toHaveAttribute(
      "href",
      "/orgs/org_01/projects/prj_01/monetization/env_prod/paywalls",
    )
  })

  it("preserves the deeper surface when switching", async () => {
    const client = seededClient(withEnvironments([development, production]))

    renderSwitcher(client, "/orgs/org_01/projects/prj_01/analytics/env_dev/funnel")
    fireEvent.click(await screen.findByRole("button", { name: /Current environment/ }))

    expect(await screen.findByRole("menuitem", { name: /Production/ })).toHaveAttribute(
      "href",
      "/orgs/org_01/projects/prj_01/analytics/env_prod/funnel",
    )
  })

  it("marks the Environment already in scope", async () => {
    const client = seededClient(withEnvironments([development, production]))

    renderSwitcher(client, "/orgs/org_01/projects/prj_01/billing/env_prod/health")
    fireEvent.click(await screen.findByRole("button", { name: /Current environment: Production/ }))

    expect(await screen.findByRole("menuitem", { name: /Production/ })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByRole("menuitem", { name: /Development/ })).not.toHaveAttribute(
      "aria-current",
    )
  })

  it("carries the current search across an in-place switch", async () => {
    const client = seededClient(withEnvironments([development, production]))

    renderSwitcher(
      client,
      "/orgs/org_01/projects/prj_01/analytics/env_dev/funnel?window=28d",
    )
    fireEvent.click(await screen.findByRole("button", { name: /Current environment/ }))

    // Analytics filters live in search; dropping them would silently reset the
    // view the operator had set up.
    expect(await screen.findByRole("menuitem", { name: /Production/ })).toHaveAttribute(
      "href",
      "/orgs/org_01/projects/prj_01/analytics/env_prod/funnel?window=28d",
    )
  })

  it("still answers the question on a surface that carries no Environment", async () => {
    const client = seededClient(withEnvironments([development, production]))

    renderSwitcher(client, "/orgs/org_01/projects/prj_01/apps")

    // The Project's first Environment stands in until a choice is made, and the
    // trigger admits the address does not name it.
    const trigger = await screen.findByRole("button", { name: /Current environment: Development/ })
    expect(trigger).toHaveTextContent("not in this page's address")

    fireEvent.click(trigger)
    // Nothing to navigate to, so selecting records the choice instead of moving
    // the operator to a page they did not ask for.
    expect(await screen.findByRole("menuitem", { name: /Production/ })).not.toHaveAttribute("href")
  })

  it("carries a choice made off-path onto the next Environment surface", async () => {
    const client = seededClient(withEnvironments([development, production]))

    const off = renderSwitcher(client, "/orgs/org_01/projects/prj_01/apps")
    fireEvent.click(await screen.findByRole("button", { name: /Current environment/ }))
    fireEvent.click(await screen.findByRole("menuitem", { name: /Production/ }))
    off.unmount()

    // This is the point of the store: the choice survives the page that could not
    // express it in its address.
    renderSwitcher(client, "/orgs/org_01/projects/prj_01/catalog/products")
    expect(
      await screen.findByRole("button", { name: /Current environment: Production/ }),
    ).toBeInTheDocument()
  })

  it("lets the address outrank the remembered choice", async () => {
    const client = seededClient(withEnvironments([development, production]))

    const off = renderSwitcher(client, "/orgs/org_01/projects/prj_01/apps")
    fireEvent.click(await screen.findByRole("button", { name: /Current environment/ }))
    fireEvent.click(await screen.findByRole("menuitem", { name: /Production/ }))
    off.unmount()

    // Otherwise a shared link would render whatever the recipient last picked.
    renderSwitcher(client, "/orgs/org_01/projects/prj_01/billing/env_dev/health")
    expect(
      await screen.findByRole("button", { name: /Current environment: Development/ }),
    ).toBeInTheDocument()
  })

  it("is absent above a Project, where Environments do not apply", () => {
    const client = seededClient(withEnvironments([development, production]))

    renderSwitcher(client, "/orgs/org_01")

    expect(screen.queryByRole("button", { name: /environment/i })).toBeNull()
  })

  it("does not mistake a literal path segment for an Environment", async () => {
    const client = seededClient(withEnvironments([development, production]))

    renderSwitcher(client, "/orgs/org_01/projects/prj_01/billing/connections/cred_01")

    // "connections" reads as the Environment slot to the scope parser. Rewriting
    // it in place would build a route that does not exist, so this surface counts
    // as carrying no Environment and offers no link.
    const trigger = await screen.findByRole("button", { name: /Current environment/ })
    expect(trigger).toHaveTextContent("not in this page's address")
    fireEvent.click(trigger)
    expect(await screen.findByRole("menuitem", { name: /Production/ })).not.toHaveAttribute("href")
  })

  it("offers a retry when the Environment list cannot be read", async () => {
    const client = seededClient((queryClient) => {
      queryClient.setQueryDefaults(environmentKeys.list("prj_01"), {
        queryFn: () =>
          Promise.reject(
            new ApiError("boom", {
              code: "internal_error",
              correlationId: "request_test",
              retryable: true,
              status: 500,
            }),
          ),
        retry: false,
      })
    })

    renderSwitcher(client, "/orgs/org_01/projects/prj_01/monetization/env_dev/paywalls")

    expect(
      await screen.findByRole("button", { name: "Retry loading environments" }),
    ).toBeInTheDocument()
  })
})
