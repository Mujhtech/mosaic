import { createFileRoute } from "@tanstack/react-router"

import { NewExperimentPage } from "@/features/experiments/components/new-experiment-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/experiments/new",
)({ component: RouteComponent })

function RouteComponent() {
  return <NewExperimentPage {...Route.useParams()} />
}
