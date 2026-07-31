import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { TransactionFactDetailPage } from "@/features/billing-ledger/components/transaction-fact-detail-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/transactions/$factId",
)({
  component: BillingTransactionFactRoute,
  head: () => routeHead({ title: "Transaction" }),
  pendingComponent: RoutePendingState,
})

function BillingTransactionFactRoute() {
  const { factId, organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  if (!environmentId) return fallback
  return (
    <TransactionFactDetailPage
      environmentId={environmentId}
      factId={factId}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
