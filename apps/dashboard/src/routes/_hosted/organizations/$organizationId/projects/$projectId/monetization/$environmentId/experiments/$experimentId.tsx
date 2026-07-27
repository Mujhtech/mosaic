import { createFileRoute } from "@tanstack/react-router"

import { ExperimentWorkspace } from "@/features/experiments/components/experiment-workspace"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/experiments/$experimentId",
)({ component: RouteComponent })

function RouteComponent() {
  return <ExperimentWorkspace {...Route.useParams()} />
}
