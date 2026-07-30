import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ProviderConnectionsPage } from "@/features/provider-connections/components/provider-connections-page"
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access"
import { routeHead } from "@/lib/routing/route-head"

interface ProviderConnectionsSearch {
  environmentId?: string
  returnTo?: string
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/providers",
)({
  component: ProjectProviderConnectionsRoute,
  head: () => routeHead({ title: "Provider connections" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): ProviderConnectionsSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "")
    return {
      environmentId:
        typeof search.environmentId === "string" && search.environmentId.length > 0
          ? search.environmentId
          : undefined,
      ...(returnTo ? { returnTo } : {}),
    }
  },
})

function ProjectProviderConnectionsRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, returnTo } = Route.useSearch()

  return (
    <ProviderConnectionsPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      returnTo={returnTo}
    />
  )
}
