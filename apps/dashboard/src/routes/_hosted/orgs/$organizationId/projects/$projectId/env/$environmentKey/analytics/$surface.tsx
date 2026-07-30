import { createFileRoute, notFound } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { AnalyticsWorkspace } from "@/features/analytics/components/analytics-workspace"
import { analyticsSurfaces, type AnalyticsSurface } from "@/features/analytics/types/analytics"
import { parseAnalyticsFilters } from "@/features/analytics/types/analytics-filters"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/analytics/$surface",
)({
  head: () => routeHead({ title: "Analytics" }),
  validateSearch: parseAnalyticsFilters,
  component: RouteComponent,
  pendingComponent: RoutePendingState,
})

function RouteComponent() {
  const params = Route.useParams()
  const filters = Route.useSearch()
  if (!analyticsSurfaces.includes(params.surface as AnalyticsSurface)) throw notFound()
  return (
    <AnalyticsWorkspace
      {...params}
      filters={filters}
      surface={params.surface as AnalyticsSurface}
    />
  )
}
