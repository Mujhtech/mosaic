import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ExperimentsPage } from "@/features/experiments/components/experiments-page"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/",
)({ component: RouteComponent, pendingComponent: RoutePendingState })

function RouteComponent() {
  return <ExperimentsPage {...Route.useParams()} />
}
