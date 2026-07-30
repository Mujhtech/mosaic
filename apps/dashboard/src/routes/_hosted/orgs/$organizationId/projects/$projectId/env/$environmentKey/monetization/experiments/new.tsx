import { createFileRoute } from "@tanstack/react-router"

import { NewExperimentPage } from "@/features/experiments/components/new-experiment-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/new",
)({
  component: RouteComponent,
  head: () => routeHead({ title: "New experiment" }),
})

function RouteComponent() {
  return <NewExperimentPage {...Route.useParams()} />
}
