/// <reference types="vite/client" />

import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { RootErrorComponent } from "@/components/feedback/root-error-component";
import { RouteNotFoundState } from "@/components/feedback/route-feedback";
import { RootDocument } from "@/components/layout/root-document";
import { dashboardBuildInfo } from "@/config/environment";
import { APP_DESCRIPTION, routeHead } from "@/lib/routing/route-head";
import { AppProviders } from "@/providers/app-providers";
import type { RouterContext } from "@/router-context";
import globalStyles from "@/styles/globals.css?url";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  head: () => ({
    links: [{ href: globalStyles, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      ...routeHead({ description: APP_DESCRIPTION }).meta,
      // Lets an operator identify the exact bundle a browser loaded without
      // opening a console.
      {
        content: `${dashboardBuildInfo.version}+${dashboardBuildInfo.commit}`,
        name: "mosaic:dashboard-version",
      },
    ],
  }),
  notFoundComponent: RouteNotFoundState,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <RootDocument>
      <AppProviders queryClient={queryClient}>
        <Outlet />
      </AppProviders>
    </RootDocument>
  );
}
