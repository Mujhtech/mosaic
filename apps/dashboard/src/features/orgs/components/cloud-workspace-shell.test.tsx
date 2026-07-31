import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { sessionKeys } from "@/features/auth/queries/session-query";
import { environmentKeys } from "@/features/environments/queries/environments-query";
import { memberKeys } from "@/features/members/queries/members-query";
import { CloudWorkspaceShell } from "@/features/orgs/components/cloud-workspace-shell";
import { workspaceBootstrapKeys } from "@/features/orgs/queries/workspace-bootstrap-query";

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

const PATHS = [
  "/orgs/$organizationId/projects/$projectId",
  "/orgs/$organizationId/projects/$projectId/env/$environmentKey",
  "/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls",
] as const;

function seededClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(sessionKeys.current, {
    email: "operator@example.test",
    id: "actor_01",
  });
  client.setQueryData(memberKeys.list("org_01"), {
    items: [
      {
        ...timestamps,
        actorId: "actor_01",
        organizationId: "org_01",
        role: "owner",
      },
    ],
    page: { nextCursor: "" },
  });
  client.setQueryData(environmentKeys.list("prj_01"), {
    items: [
      {
        ...timestamps,
        id: "env_dev",
        key: "development",
        mode: "development",
        name: "Development",
        projectId: "prj_01",
      },
    ],
    page: { nextCursor: "" },
  });
  client.setQueryData(workspaceBootstrapKeys.all, { organizations: [] });
  return client;
}

function renderShell(pathname: string) {
  const rootRoute = createRootRoute();
  const routeTree = rootRoute.addChildren(
    PATHS.map((path) =>
      createRoute({
        component: CloudWorkspaceShell,
        getParentRoute: () => rootRoute,
        path,
      })
    )
  );
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [pathname] }),
    routeTree,
  });

  return render(
    <QueryClientProvider client={seededClient()}>
      <SidebarProvider>
        <RouterProvider router={router} />
      </SidebarProvider>
    </QueryClientProvider>
  );
}

/**
 * The switcher being wired into the shell is not the same as the shell rendering
 * it: a client-only guard once compiled fine and still never ran. These assert on
 * the mounted output.
 */
describe("CloudWorkspaceShell", () => {
  it("mounts the Environment switcher on an Environment-scoped surface", async () => {
    renderShell("/orgs/org_01/projects/prj_01/env/dev/monetization/paywalls");

    expect(
      await screen.findByRole("button", {
        name: /Current environment: Development/,
      })
    ).toBeInTheDocument();
  });

  it("still offers it where the path carries no Environment", async () => {
    renderShell("/orgs/org_01/projects/prj_01");

    // Present on every Project surface, including one whose address names no
    // Environment.
    const trigger = await screen.findByRole("button", {
      name: /Current environment: Development/,
    });
    expect(trigger).toBeInTheDocument();
  });
});
