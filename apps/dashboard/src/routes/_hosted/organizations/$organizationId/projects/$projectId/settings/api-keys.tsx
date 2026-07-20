import { createFileRoute } from "@tanstack/react-router"

import { ApiKeysPage } from "@/features/api-keys/components/api-keys-page"

interface ApiKeysSearch {
  environmentId?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/settings/api-keys",
)({
  component: ProjectApiKeysRoute,
  validateSearch: (search: Record<string, unknown>): ApiKeysSearch => ({
    environmentId:
      typeof search.environmentId === "string" && search.environmentId.length > 0
        ? search.environmentId
        : undefined,
  }),
})

function ProjectApiKeysRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId } = Route.useSearch()

  return (
    <ApiKeysPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
