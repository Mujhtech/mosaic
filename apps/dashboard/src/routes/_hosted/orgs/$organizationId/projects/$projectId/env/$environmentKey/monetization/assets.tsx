import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";

import { AssetsPage } from "@/features/assets/components/assets-page";
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access";
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment";
import { routeHead } from "@/lib/routing/route-head";

interface AssetsRouteSearch {
  returnTo?: string;
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/assets"
)({
  validateSearch: (search: Record<string, unknown>): AssetsRouteSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "");
    return returnTo ? { returnTo } : {};
  },
  component: RouteComponent,
  head: () => routeHead({ title: "Assets" }),
  pendingComponent: RoutePendingState,
});

function RouteComponent() {
  const { organizationId, projectId } = Route.useParams();
  const { environmentId, fallback } = useRouteEnvironment();
  const { returnTo } = Route.useSearch();
  if (!environmentId) {
    return fallback;
  }

  return (
    <AssetsPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      returnTo={returnTo}
    />
  );
}
