import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"
import type { BootstrapOrganization, Project } from "@/generated/api"
import { WorkspaceEntryRedirect } from "@/features/orgs/components/workspace-entry-redirect"
import { workspaceBootstrapKeys } from "@/features/orgs/queries/workspace-bootstrap-query"
import { ApiError } from "@/lib/api/errors"

// The degraded branch renders the workspace shell's Organization list, which
// reads a media query jsdom does not implement.
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

function project(id: string, organizationId: string): Project {
  return { ...timestamps, id, key: id, name: id, organizationId, status: "active" }
}

function organization(id: string, projects: Project[] = []): BootstrapOrganization {
  return {
    organization: { ...timestamps, id, name: id },
    projectCount: projects.length,
    projects,
    projectsTruncated: false,
    role: "owner",
  }
}

function renderEntry(queryClient: QueryClient) {
  const rootRoute = createRootRoute()
  const routeTree = rootRoute.addChildren([
    createRoute({
      component: WorkspaceEntryRedirect,
      getParentRoute: () => rootRoute,
      path: "/workspace",
    }),
    createRoute({ getParentRoute: () => rootRoute, path: "/orgs/new" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/orgs/$organizationId" }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/orgs/$organizationId/projects/new",
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/orgs/$organizationId/projects/$projectId/env/$environmentKey",
    }),
  ])

  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/workspace"] }),
    routeTree,
  })

  render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RouterProvider router={router} />
      </SidebarProvider>
    </QueryClientProvider>,
  )

  return router
}

function seededClient(seed: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed(client)
  return client
}

/**
 * Entry shipped as a beforeLoad that returned early under `import.meta.env.SSR`.
 * On a hard load that guard ran only on the server, and Start does not re-run it
 * after hydration, so the redirect never happened and the operator sat on
 * /workspace. These assertions are on the resulting location, which is the part
 * that was broken while the resolver itself was correct.
 */
describe("WorkspaceEntryRedirect", () => {
  it("leaves /workspace for the first Project", async () => {
    const client = seededClient((queryClient) => {
      queryClient.setQueryData(workspaceBootstrapKeys.all, {
        organizations: [organization("org_01", [project("prj_01", "org_01")])],
      })
    })

    const router = renderEntry(client)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/orgs/org_01/projects/prj_01")
    })
  })

  it("sends an operator with no Organizations to create one", async () => {
    const client = seededClient((queryClient) => {
      queryClient.setQueryData(workspaceBootstrapKeys.all, { organizations: [] })
    })

    const router = renderEntry(client)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/orgs/new")
    })
  })

  it("replaces the entry route so Back does not bounce forward again", async () => {
    const client = seededClient((queryClient) => {
      queryClient.setQueryData(workspaceBootstrapKeys.all, {
        organizations: [organization("org_01", [project("prj_01", "org_01")])],
      })
    })

    const router = renderEntry(client)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/orgs/org_01/projects/prj_01")
    })

    expect(router.history.canGoBack()).toBe(false)
  })

  it("shows the Organization list with a retry when the snapshot cannot be read", async () => {
    const client = seededClient((queryClient) => {
      queryClient.setQueryDefaults(workspaceBootstrapKeys.all, {
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

    const router = renderEntry(client)

    expect(await screen.findByRole("heading", { name: "Organizations" })).toBeVisible()
    expect(router.state.location.pathname).toBe("/workspace")
  })
})
