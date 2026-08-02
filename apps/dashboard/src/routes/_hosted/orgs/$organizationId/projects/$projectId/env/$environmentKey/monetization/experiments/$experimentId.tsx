import { createFileRoute } from "@tanstack/react-router";

import { ExperimentWorkspace } from "@/features/experiments/components/experiment-workspace";
import { routeHead } from "@/lib/routing/route-head";

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/$experimentId"
)({
  component: RouteComponent,
  head: () => routeHead({ title: "Experiment" }),
});

function RouteComponent() {
  return <ExperimentWorkspace {...Route.useParams()} />;
}
