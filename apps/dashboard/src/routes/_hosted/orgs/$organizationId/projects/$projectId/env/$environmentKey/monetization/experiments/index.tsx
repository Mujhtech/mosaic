import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ExperimentsPage } from "@/features/experiments/components/experiments-page"
import { routeHead } from "@/lib/routing/route-head"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/",
)({
  component: RouteComponent,
  head: () => routeHead({ title: "Experiments" }),
  pendingComponent: RoutePendingState,
})

function RouteComponent() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return <ExperimentsPage   environmentId={environmentId}
  organizationId={organizationId}
  projectId={projectId} />
}
