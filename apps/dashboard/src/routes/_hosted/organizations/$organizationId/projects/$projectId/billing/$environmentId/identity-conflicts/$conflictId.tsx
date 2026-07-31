import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { IdentityConflictDetailPage } from "@/features/billing-customers/components/identity-conflict-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/identity-conflicts/$conflictId",
)({
  component: IdentityConflictDetailRoute,
  pendingComponent: RoutePendingState,
})

function IdentityConflictDetailRoute() {
  const { conflictId, environmentId, organizationId, projectId } = Route.useParams()
  return (
    <IdentityConflictDetailPage
      conflictId={conflictId}
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
