import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"
import { MigrationProgramsPage } from "@/features/billing-migrations/components/migration-programs-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/migrations/",
)({
  component: MigrationProgramsRoute,
  head: () => routeHead({ title: "Migrations" }),
  pendingComponent: RoutePendingState,
})

function MigrationProgramsRoute() {
  const { organizationId, projectId } = Route.useParams()
  return <MigrationProgramsPage organizationId={organizationId} projectId={projectId} />
}
