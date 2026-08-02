import { createFileRoute } from "@tanstack/react-router";

import { ProviderConnectionDetailPage } from "@/features/provider-connections/components/provider-connection-detail-page";
import { routeHead } from "@/lib/routing/route-head";

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/providers/$connectionId"
)({
  component: ProjectProviderConnectionDetailRoute,
  head: () => routeHead({ title: "Provider connection" }),
});

function ProjectProviderConnectionDetailRoute() {
  const { connectionId, organizationId, projectId } = Route.useParams();
  return (
    <ProviderConnectionDetailPage
      connectionId={connectionId}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}
