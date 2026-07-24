import { createFileRoute } from "@tanstack/react-router"

import { ProviderConnectionDetailPage } from "@/features/provider-connections/components/provider-connection-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/catalog/providers/$connectionId",
)({
  component: ProjectProviderConnectionDetailRoute,
})

function ProjectProviderConnectionDetailRoute() {
  const { connectionId, organizationId, projectId } = Route.useParams()
  return (
    <ProviderConnectionDetailPage
      connectionId={connectionId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
