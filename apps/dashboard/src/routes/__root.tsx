/// <reference types="vite/client" />

import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  type ErrorComponentProps,
} from "@tanstack/react-router"
import type { ReactNode } from "react"

import { RouteErrorState, RouteNotFoundState } from "@/components/feedback/route-feedback"
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

function RootErrorComponent(props: ErrorComponentProps) {
  return (
    <RootDocument>
      <main id="main-content">
        <RouteErrorState {...props} />
      </main>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="app-root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}
