import { createFileRoute } from "@tanstack/react-router"

import { ProviderConnectionsPage } from "@/features/provider-connections/components/provider-connections-page"
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access"

interface ProviderConnectionsSearch {
  environmentId?: string
  returnTo?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/providers",
)({
  component: ProjectProviderConnectionsRoute,
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
