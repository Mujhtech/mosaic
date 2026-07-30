import { createFileRoute } from "@tanstack/react-router"

import { NewExperimentPage } from "@/features/experiments/components/new-experiment-page"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/new",
)({ component: RouteComponent })

function RouteComponent() {
  return <NewExperimentPage {...Route.useParams()} />
}
