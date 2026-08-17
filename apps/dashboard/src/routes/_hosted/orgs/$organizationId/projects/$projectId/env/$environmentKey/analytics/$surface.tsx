import { createFileRoute, notFound } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";

import { AnalyticsWorkspace } from "@/features/analytics/components/analytics-workspace";
import {
  type AnalyticsSurface,
  analyticsSurfaces,
} from "@/features/analytics/types/analytics";
import { parseAnalyticsFilters } from "@/features/analytics/types/analytics-filters";
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment";
import { routeHead } from "@/lib/routing/route-head";

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/analytics/$surface"
)({
  validateSearch: parseAnalyticsFilters,
  head: () => routeHead({ title: "Analytics" }),
  component: RouteComponent,
  pendingComponent: RoutePendingState,
});

function RouteComponent() {
  const params = Route.useParams();
  const filters = Route.useSearch();
  const { environmentId, fallback } = useRouteEnvironment();
  if (!environmentId) {
    return fallback;
  }
  if (!analyticsSurfaces.includes(params.surface as AnalyticsSurface)) {
    throw notFound();
  }
  return (
    <AnalyticsWorkspace
      {...params}
      environmentId={environmentId}
      filters={filters}
      surface={params.surface as AnalyticsSurface}
    />
  );
}
