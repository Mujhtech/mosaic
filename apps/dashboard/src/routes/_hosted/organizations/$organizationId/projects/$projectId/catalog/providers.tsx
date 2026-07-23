import { createFileRoute } from "@tanstack/react-router"

import { ProviderConnectionsPage } from "@/features/provider-connections/components/provider-connections-page"

interface ProviderConnectionsSearch {
  environmentId?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/providers",
)({
  component: ProjectProviderConnectionsRoute,
  validateSearch: (search: Record<string, unknown>): ProviderConnectionsSearch => ({
    environmentId:
      typeof search.environmentId === "string" && search.environmentId.length > 0
        ? search.environmentId
        : undefined,
  }),
})

function ProjectProviderConnectionsRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId } = Route.useSearch()

  return (
    <ProviderConnectionsPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
