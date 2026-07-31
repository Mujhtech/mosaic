import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"
import { OrganizationSwitcher } from "@/features/organizations/components/organization-switcher"
import { organizationKeys } from "@/features/organizations/queries/organizations-query"
import { ApiError } from "@/lib/api/errors"

// The sidebar reads a media query to decide between its desktop and mobile
// presentation; jsdom does not implement matchMedia.
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

function renderSwitcher(queryClient: QueryClient, organizationId?: string) {
  const rootRoute = createRootRoute()
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => (
        <SidebarProvider>
          <OrganizationSwitcher organizationId={organizationId} />
        </SidebarProvider>
      ),
    }),
    createRoute({ getParentRoute: () => rootRoute, path: "/organizations/new" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/organizations/$organizationId" }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/organizations/$organizationId/projects/new",
    }),
  ])

  const router = createRouter({ history: createMemoryHistory(), routeTree })

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

function seededClient(seed: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  seed(client)
  return client
}

/**
 * The switcher shipped non-functional: its items were not links, so an operator
 * could not change Organization at all, and a failed list request rendered the
 * "no organizations yet" branch, which reads as "your data is gone".
 */
describe("OrganizationSwitcher", () => {
  it("navigates to each Organization and names the current one", async () => {
    const client = seededClient((queryClient) => {
      queryClient.setQueryData(organizationKeys.list(), {
        items: [
          { id: "org_01", name: "Northwind" },
          { id: "org_02", name: "Contoso" },
        ],
      })
    })

    renderSwitcher(client, "org_02")

    const trigger = await screen.findByRole("button", {
      name: /Current organization: Contoso/,
    })
    fireEvent.click(trigger)

    const northwind = await screen.findByRole("menuitem", { name: "Northwind" })
    expect(northwind).toHaveAttribute("href", "/organizations/org_01")
    expect(screen.getByRole("menuitem", { name: "Contoso" })).toHaveAttribute(
      "href",
      "/organizations/org_02",
    )
    expect(screen.getByRole("menuitem", { name: "Add project" })).toHaveAttribute(
      "href",
      "/organizations/org_02/projects/new",
    )
  })

  it("offers a retry instead of claiming there are no Organizations when the list fails", async () => {
    const client = seededClient((queryClient) => {
      queryClient.setQueryDefaults(organizationKeys.list(), {
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

    renderSwitcher(client)

    const trigger = await screen.findByRole("button", { name: /Switch organization/ })
    fireEvent.click(trigger)

    expect(await screen.findByRole("button", { name: "Retry loading organizations" })).toBeVisible()
    expect(screen.queryByText("You do not belong to an organization yet.")).toBeNull()
    // "Add project" needs an Organization in scope; offering it here would be a
    // dead link.
    expect(screen.queryByRole("menuitem", { name: "Add project" })).toBeNull()
  })
})
