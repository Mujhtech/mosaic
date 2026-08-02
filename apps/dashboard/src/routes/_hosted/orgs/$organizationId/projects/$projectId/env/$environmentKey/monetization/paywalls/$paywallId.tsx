import { createFileRoute } from "@tanstack/react-router";
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment";
import { PaywallDetailPage } from "@/features/paywalls/components/paywall-detail-page";
import { routeHead } from "@/lib/routing/route-head";

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls/$paywallId"
)({
  component: RouteComponent,
  head: () => routeHead({ title: "Paywall" }),
});

function RouteComponent() {
  const { organizationId, paywallId, projectId } = Route.useParams();
  const { environmentId, fallback } = useRouteEnvironment();
  if (!environmentId) {
    return fallback;
  }
  return (
    <PaywallDetailPage
      environmentId={environmentId}
      organizationId={organizationId}
      paywallId={paywallId}
      projectId={projectId}
    />
  );
}
