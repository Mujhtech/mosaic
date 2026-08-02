import { createFileRoute } from "@tanstack/react-router";

import { RoutePendingState } from "@/components/feedback/route-feedback";

import { TransactionLedgerPage } from "@/features/billing-ledger/components/transaction-ledger-page";
import {
  parseTransactionFilters,
  serializeTransactionFilters,
} from "@/features/billing-ledger/types/transaction-filters";
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment";
import { routeHead } from "@/lib/routing/route-head";

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/transactions/"
)({
  component: BillingTransactionsRoute,
  head: () => routeHead({ title: "Transactions" }),
  pendingComponent: RoutePendingState,
  // The Mosaic Environment is a path parameter and is deliberately never read
  // from the search string, so a crafted URL cannot retarget the view.
  validateSearch: parseTransactionFilters,
});

function BillingTransactionsRoute() {
  const { organizationId, projectId } = Route.useParams();
  const { environmentId, fallback } = useRouteEnvironment();
  const filters = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!environmentId) {
    return fallback;
  }

  return (
    <TransactionLedgerPage
      environmentId={environmentId}
      filters={filters}
      onFiltersChange={(nextFilters) => {
        navigate({
          replace: true,
          search: serializeTransactionFilters(nextFilters),
        });
      }}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}
