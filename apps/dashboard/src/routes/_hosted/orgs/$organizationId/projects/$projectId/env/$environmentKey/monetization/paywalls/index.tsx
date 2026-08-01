import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment";
import { PaywallsPage } from "@/features/paywalls/components/paywalls-page";
import { routeHead } from "@/lib/routing/route-head";

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls/"
)({
  component: RouteComponent,
  head: () => routeHead({ title: "Paywalls" }),
  pendingComponent: RoutePendingState,
});

function RouteComponent() {
  const { organizationId, projectId } = Route.useParams();
  const { environmentId, fallback } = useRouteEnvironment();
  if (!environmentId) {
    return fallback;
  }
  return (
    <PaywallsPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}
