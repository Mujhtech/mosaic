import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";

import { ApiKeysPage } from "@/features/api-keys/components/api-keys-page";
import { routeHead } from "@/lib/routing/route-head";

interface ApiKeysSearch {
  environmentId?: string;
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/settings/api-keys"
)({
  validateSearch: (search: Record<string, unknown>): ApiKeysSearch => ({
    environmentId:
      typeof search.environmentId === "string" &&
      search.environmentId.length > 0
        ? search.environmentId
        : undefined,
  }),
  component: ProjectApiKeysRoute,
  head: () => routeHead({ title: "API keys" }),
  pendingComponent: RoutePendingState,
});

function ProjectApiKeysRoute() {
  const { organizationId, projectId } = Route.useParams();
  const { environmentId } = Route.useSearch();

  return (
    <ApiKeysPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}
