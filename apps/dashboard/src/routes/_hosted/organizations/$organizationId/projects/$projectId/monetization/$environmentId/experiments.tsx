import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ExperimentsPage } from "@/features/experiments/components/experiments-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/experiments",
)({ component: RouteComponent, pendingComponent: RoutePendingState })

function RouteComponent() {
  return <ExperimentsPage {...Route.useParams()} />
}
