import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { IdentityConflictDetailPage } from "@/features/billing-customers/components/identity-conflict-detail-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/identity-conflicts/$conflictId",
)({
  component: IdentityConflictDetailRoute,
  head: () => routeHead({ title: "Identity conflict" }),
  pendingComponent: RoutePendingState,
})

function IdentityConflictDetailRoute() {
  const { conflictId, organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return (
    <IdentityConflictDetailPage
      conflictId={conflictId}
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
