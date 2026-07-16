import { createRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query"

import { RouteErrorState, RouteNotFoundState } from "@/components/feedback/route-feedback"
import { createDashboardQueryClient } from "@/lib/query/query-client"
import { routeTree } from "@/routeTree.gen"

export function getRouter() {
  const queryClient = createDashboardQueryClient()
  const router = createRouter({
    context: { queryClient },
    defaultErrorComponent: RouteErrorState,
    defaultNotFoundComponent: RouteNotFoundState,
    defaultPreload: "intent",
    routeTree,
    scrollRestoration: true,
  })

  setupRouterSsrQueryIntegration({
    queryClient,
    router,
    wrapQueryClient: false,
  })

  return router
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
