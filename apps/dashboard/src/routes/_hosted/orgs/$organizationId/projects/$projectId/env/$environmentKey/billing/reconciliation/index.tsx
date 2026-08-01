import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";

import { ReconciliationPage } from "@/features/billing-operations/components/reconciliation-page";
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment";
import { routeHead } from "@/lib/routing/route-head";

interface ReconciliationSearch {
  cursor?: string;
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/reconciliation/"
)({
  component: BillingReconciliationRoute,
  head: () => routeHead({ title: "Reconciliation" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): ReconciliationSearch => ({
    cursor:
      typeof search.cursor === "string" &&
      search.cursor.length > 0 &&
      search.cursor.length <= 512
        ? search.cursor
        : undefined,
  }),
});

function BillingReconciliationRoute() {
  const { organizationId, projectId } = Route.useParams();
  const { environmentId, fallback } = useRouteEnvironment();
  const { cursor } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!environmentId) {
    return fallback;
  }

  return (
    <ReconciliationPage
      {...(cursor ? { cursor } : {})}
      environmentId={environmentId}
      onCursorChange={(nextCursor) => {
        navigate({
          replace: true,
          search: nextCursor ? { cursor: nextCursor } : {},
        });
      }}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}
