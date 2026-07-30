import { createFileRoute } from "@tanstack/react-router"

import { ExperimentWorkspace } from "@/features/experiments/components/experiment-workspace"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/$experimentId",
)({ component: RouteComponent })

function RouteComponent() {
  return <ExperimentWorkspace {...Route.useParams()} />
}
