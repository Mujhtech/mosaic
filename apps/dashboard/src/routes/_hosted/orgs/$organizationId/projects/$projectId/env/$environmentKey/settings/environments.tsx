import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";

import { EnvironmentsPage } from "@/features/environments/components/environments-page";
import { routeHead } from "@/lib/routing/route-head";

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/settings/environments"
)({
  component: ProjectEnvironmentsRoute,
  head: () => routeHead({ title: "Environments" }),
  pendingComponent: RoutePendingState,
});

function ProjectEnvironmentsRoute() {
  const { environmentKey, organizationId, projectId } = Route.useParams();

  return (
    <EnvironmentsPage
      environmentKey={environmentKey}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}
