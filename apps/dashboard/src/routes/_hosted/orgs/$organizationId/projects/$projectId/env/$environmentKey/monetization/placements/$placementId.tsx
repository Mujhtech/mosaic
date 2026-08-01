import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment";
import { PlacementDecisionPage } from "@/features/placement-decisions/components/placement-decision-page";
import { routeHead } from "@/lib/routing/route-head";

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/placements/$placementId"
)({
  component: PlacementDecisionRoute,
  head: () => routeHead({ title: "Placement" }),
  pendingComponent: RoutePendingState,
});

function PlacementDecisionRoute() {
  const { organizationId, placementId, projectId } = Route.useParams();
  // The route carries the Environment key; the page needs the resolved id.
  const { environmentId, fallback } = useRouteEnvironment();
  if (!environmentId) {
    return fallback;
  }
  return (
    <PlacementDecisionPage
      environmentId={environmentId}
      organizationId={organizationId}
      placementId={placementId}
      projectId={projectId}
    />
  );
}
