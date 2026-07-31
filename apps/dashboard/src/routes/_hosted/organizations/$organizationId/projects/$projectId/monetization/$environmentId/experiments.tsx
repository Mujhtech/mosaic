import { createFileRoute } from "@tanstack/react-router"

import { ExperimentsPage } from "@/features/experiments/components/experiments-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/experiments",
)({ component: RouteComponent })

function RouteComponent() {
  return <ExperimentsPage {...Route.useParams()} />
}
