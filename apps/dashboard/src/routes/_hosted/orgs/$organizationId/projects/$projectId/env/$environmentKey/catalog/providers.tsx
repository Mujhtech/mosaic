import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access";
import { ProviderConnectionsPage } from "@/features/provider-connections/components/provider-connections-page";
import { routeHead } from "@/lib/routing/route-head";

interface ProviderConnectionsSearch {
  returnTo?: string;
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/providers"
)({
  component: ProjectProviderConnectionsRoute,
  head: () => routeHead({ title: "Provider connections" }),
  pendingComponent: RoutePendingState,
  validateSearch: (
    search: Record<string, unknown>
  ): ProviderConnectionsSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "");
    return returnTo ? { returnTo } : {};
  },
});

function ProjectProviderConnectionsRoute() {
  const { organizationId, projectId } = Route.useParams();
  const { returnTo } = Route.useSearch();

  return (
    <ProviderConnectionsPage
      organizationId={organizationId}
      projectId={projectId}
      returnTo={returnTo}
    />
  );
}
