import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { TransactionLedgerPage } from "@/features/billing-ledger/components/transaction-ledger-page"
import {
  parseTransactionFilters,
  serializeTransactionFilters,
} from "@/features/billing-ledger/types/transaction-filters"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/transactions/",
)({
  component: BillingTransactionsRoute,
  pendingComponent: RoutePendingState,
  // The Mosaic Environment is a path parameter and is deliberately never read
  // from the search string, so a crafted URL cannot retarget the view.
  validateSearch: parseTransactionFilters,
})

function BillingTransactionsRoute() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <TransactionLedgerPage
      environmentId={environmentId}
      filters={filters}
      onFiltersChange={(nextFilters) => {
        void navigate({ replace: true, search: serializeTransactionFilters(nextFilters) })
      }}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
