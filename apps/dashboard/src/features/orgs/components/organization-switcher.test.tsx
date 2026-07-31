import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { OrganizationSwitcher } from "@/features/orgs/components/organization-switcher";
import { workspaceBootstrapKeys } from "@/features/orgs/queries/workspace-bootstrap-query";
import type { BootstrapOrganization, Project, Role } from "@/generated/api";
import { ApiError } from "@/lib/api/errors";

// The sidebar reads a media query to decide between its desktop and mobile
// presentation; jsdom does not implement matchMedia.
beforeAll(() => {
  if (typeof window.matchMedia === "function") {
    return;
  }
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
    }) as MediaQueryList;
});

const timestamps = {
  createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z",
};

function project(id: string, name: string, organizationId: string): Project {
  return { ...timestamps, id, key: id, name, organizationId, status: "active" };
}

function organization(
  id: string,
  name: string,
  {
    projectCount,
    projects = [],
    role = "owner" as Role,
  }: { projectCount?: number; projects?: Project[]; role?: Role } = {}
): BootstrapOrganization {
  return {
    organization: { ...timestamps, id, name },
    projectCount: projectCount ?? projects.length,
    projects,
    projectsTruncated: (projectCount ?? projects.length) > projects.length,
    role,
  };
}

function renderSwitcher(
  queryClient: QueryClient,
  { organizationId, pathname }: { organizationId?: string; pathname: string }
) {
  const component = () => (
    <SidebarProvider>
      <OrganizationSwitcher organizationId={organizationId} />
    </SidebarProvider>
  );
  const rootRoute = createRootRoute();
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/", component }),
    createRoute({ getParentRoute: () => rootRoute, path: "/orgs/new" }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/orgs/$organizationId",
      component,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/orgs/$organizationId/projects/new",
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/orgs/$organizationId/projects/$projectId/env/$environmentKey",
      component,
    }),
  ]);

  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [pathname] }),
    routeTree,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function seededClient(seed: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  seed(client);
  return client;
}

function withBootstrap(organizations: BootstrapOrganization[]) {
  return (client: QueryClient) => {
    client.setQueryData(workspaceBootstrapKeys.all, { organizations });
  };
}

async function openSwitcher() {
  fireEvent.click(
    await screen.findByRole("button", {
      name: /Switch project or organization/,
    })
  );
}

/**
 * The switcher shipped non-functional: its items were not links, so an operator
 * could not change Organization at all, and a failed list request rendered the
 * "no organizations yet" branch, which reads as "your data is gone". Projects,
 * the unit of daily work, were not reachable from it at all.
 */
describe("OrganizationSwitcher", () => {
  it("lists the current Organization's Projects and names the one in scope", async () => {
    const client = seededClient(
      withBootstrap([
        organization("org_01", "Northwind", {
          projects: [
            project("prj_01", "Mobile", "org_01"),
            project("prj_02", "Web", "org_01"),
          ],
        }),
      ])
    );

    renderSwitcher(client, {
      organizationId: "org_01",
      pathname: "/orgs/org_01/projects/prj_02/env/dev",
    });

    const trigger = await screen.findByRole("button", {
      name: /Current project: Web/,
    });
    expect(trigger).toHaveAccessibleName(/Current organization: Northwind/);
    fireEvent.click(trigger);

    expect(
      await screen.findByRole("menuitem", { name: "Mobile" })
    ).toHaveAttribute("href", "/orgs/org_01/projects/prj_01/env/dev");
    expect(screen.getByRole("menuitem", { name: "Web" })).toHaveAttribute(
      "href",
      "/orgs/org_01/projects/prj_02/env/dev"
    );
    expect(
      screen.getByRole("menuitem", { name: "Add project" })
    ).toHaveAttribute("href", "/orgs/org_01/projects/new");
  });

  it("moves between Organizations from the switch submenu", async () => {
    const client = seededClient(
      withBootstrap([
        organization("org_01", "Northwind", {
          projects: [project("prj_01", "Mobile", "org_01")],
        }),
        organization("org_02", "Contoso"),
      ])
    );

    renderSwitcher(client, {
      organizationId: "org_01",
      pathname: "/orgs/org_01",
    });
    await openSwitcher();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Switch organization/ })
    );

    expect(
      await screen.findByRole("menuitem", { name: "Contoso" })
    ).toHaveAttribute("href", "/orgs/org_02");
    expect(
      screen.getByRole("menuitem", { name: "Add organization" })
    ).toHaveAttribute("href", "/orgs/new");
  });

  it("offers a retry instead of claiming there are no Projects when the read fails", async () => {
    const client = seededClient((queryClient) => {
      queryClient.setQueryDefaults(workspaceBootstrapKeys.all, {
        queryFn: () =>
          Promise.reject(
            new ApiError("boom", {
              code: "internal_error",
              correlationId: "request_test",
              retryable: true,
              status: 500,
            })
          ),
        retry: false,
      });
    });

    renderSwitcher(client, { pathname: "/" });
    await openSwitcher();

    expect(
      await screen.findByRole("button", { name: "Retry loading organizations" })
    ).toBeVisible();
    expect(
      screen.queryByText("You do not belong to an organization yet.")
    ).toBeNull();
    // "Add project" needs an Organization in scope; offering it here would be a
    // dead link.
    expect(screen.queryByRole("menuitem", { name: "Add project" })).toBeNull();
  });

  it("withholds Add project from a member, who cannot create one", async () => {
    const client = seededClient(
      withBootstrap([
        organization("org_01", "Northwind", {
          projects: [project("prj_01", "Mobile", "org_01")],
          role: "member",
        }),
      ])
    );

    renderSwitcher(client, {
      organizationId: "org_01",
      pathname: "/orgs/org_01",
    });
    await openSwitcher();

    // Polled rather than read once: the popup remounts as the router settles, so
    // a handle taken from findBy can be detached by the time it is asserted on.
    await expect
      .poll(() =>
        screen.queryByRole("menuitem", { name: "Mobile" })?.getAttribute("href")
      )
      .toBe("/orgs/org_01/projects/prj_01/env/dev");
    expect(screen.queryByRole("menuitem", { name: "Add project" })).toBeNull();
  });

  it("says how many Projects exist when the snapshot is capped", async () => {
    const client = seededClient(
      withBootstrap([
        organization("org_01", "Northwind", {
          projectCount: 40,
          projects: [project("prj_01", "Mobile", "org_01")],
        }),
      ])
    );

    renderSwitcher(client, {
      organizationId: "org_01",
      pathname: "/orgs/org_01",
    });
    await openSwitcher();

    expect(
      await screen.findByRole("menuitem", { name: "View all 40 projects" })
    ).toHaveAttribute("href", "/orgs/org_01");
  });
});
