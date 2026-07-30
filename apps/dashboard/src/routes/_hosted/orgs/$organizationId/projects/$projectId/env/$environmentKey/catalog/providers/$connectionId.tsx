import { createFileRoute } from "@tanstack/react-router"

import { ProviderConnectionDetailPage } from "@/features/provider-connections/components/provider-connection-detail-page"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/providers/$connectionId",
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
