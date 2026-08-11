import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { environmentKeys } from "@/features/environments/queries/environments-query";
import { resetActiveEnvironmentStore } from "@/features/environments/types/active-environment-store";
import { ProjectOverviewMetricsSection } from "@/features/projects/components/project-overview-metrics";
import { ApiError } from "@/lib/api/errors";

/**
 * Risk: the metrics query is only enabled once an Environment resolves. When the
 * Environment list cannot be read there is no id, so the query never runs and
 * never leaves `isPending` — and every tile plus the trend chart would render a
 * loading skeleton forever, with no message, no retry, and no scope chips. A
 * failed read that presents as perpetual loading is indistinguishable from a
 * slow one, which is precisely the silent failure the tri-state tiles exist to
 * prevent.
 */

const PATH = "/orgs/$organizationId/projects/$projectId";

function renderSection(queryClient: QueryClient) {
  const rootRoute = createRootRoute();
  const routeTree = rootRoute.addChildren([
    createRoute({
      component: () => (
        <ProjectOverviewMetricsSection
          organizationId="org_01"
          projectId="prj_01"
        />
      ),
      getParentRoute: () => rootRoute,
      path: PATH,
    }),
  ]);

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider
        router={createRouter({
          history: createMemoryHistory({
            initialEntries: ["/orgs/org_01/projects/prj_01"],
          }),
          routeTree,
        })}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  resetActiveEnvironmentStore();
  window.localStorage.clear();
});

describe("project overview metrics", () => {
  it("reports a failed Environment read instead of loading forever", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryDefaults(environmentKeys.list("prj_01"), {
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

    renderSection(queryClient);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      /could not read this Project's Environments/
    );
    expect(
      screen.getByRole("button", { name: "Retry loading Environments" })
    ).toBeInTheDocument();
    // Nothing may still claim to be loading: the read is over and it failed.
    expect(screen.queryByLabelText(/^Loading /)).toBeNull();
  });
});
