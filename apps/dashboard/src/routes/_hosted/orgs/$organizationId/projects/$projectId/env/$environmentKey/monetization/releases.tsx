import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ReleaseHistoryPage } from "@/features/releases/components/release-history-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/releases",
)({
  component: RouteComponent,
  head: () => routeHead({ title: "Releases" }),
  pendingComponent: RoutePendingState,
})

function RouteComponent() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return (
    <ReleaseHistoryPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
