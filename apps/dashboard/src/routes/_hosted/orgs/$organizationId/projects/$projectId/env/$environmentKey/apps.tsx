import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";

import { ApplicationsPage } from "@/features/projects/components/applications-page";
import { routeHead } from "@/lib/routing/route-head";

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/apps"
)({
  component: ProjectAppsRoute,
  head: () => routeHead({ title: "Applications" }),
  pendingComponent: RoutePendingState,
});

function ProjectAppsRoute() {
  const { organizationId, projectId } = Route.useParams();

  return (
    <ApplicationsPage organizationId={organizationId} projectId={projectId} />
  );
}
