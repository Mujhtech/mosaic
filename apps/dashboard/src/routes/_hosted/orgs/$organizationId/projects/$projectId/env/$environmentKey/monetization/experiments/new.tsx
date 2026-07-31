import { createFileRoute } from "@tanstack/react-router"

import { NewExperimentPage } from "@/features/experiments/components/new-experiment-page"
import { routeHead } from "@/lib/routing/route-head"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/new",
)({
  component: RouteComponent,
  head: () => routeHead({ title: "New experiment" }),
})

function RouteComponent() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback

  return <NewExperimentPage environmentId={environmentId}
  organizationId={organizationId}
  projectId={projectId} />
}
