/// <reference types="vite/client" />

import { Outlet, createRootRouteWithContext } from "@tanstack/react-router"

import { RootErrorComponent } from "@/components/feedback/root-error-component"
import { RouteNotFoundState } from "@/components/feedback/route-feedback"
import { RootDocument } from "@/components/layout/root-document"
import { AppProviders } from "@/providers/app-providers"
import type { RouterContext } from "@/router-context"
import globalStyles from "@/styles/globals.css?url"

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  head: () => ({
    links: [{ href: globalStyles, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Mosaic Studio" },
      {
        content: "Build and operate native monetization experiences with Mosaic.",
        name: "description",
      },
    ],
  }),
  notFoundComponent: RouteNotFoundState,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()

  return (
    <RootDocument>
      <AppProviders queryClient={queryClient}>
        <Outlet />
      </AppProviders>
    </RootDocument>
  )
}
