import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { TransactionFactDetailPage } from "@/features/billing-ledger/components/transaction-fact-detail-page"

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/transactions/$factId",
)({
  component: BillingTransactionFactRoute,
  pendingComponent: RoutePendingState,
})

function BillingTransactionFactRoute() {
  const { environmentId, factId, organizationId, projectId } = Route.useParams()
  return (
    <TransactionFactDetailPage
      environmentId={environmentId}
      factId={factId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
