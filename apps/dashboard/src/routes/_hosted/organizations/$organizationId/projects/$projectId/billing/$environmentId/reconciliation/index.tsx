import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { ReconciliationPage } from "@/features/billing-operations/components/reconciliation-page"

interface ReconciliationSearch {
  cursor?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/reconciliation/",
)({
  component: BillingReconciliationRoute,
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): ReconciliationSearch => ({
    cursor:
      typeof search.cursor === "string" && search.cursor.length > 0 && search.cursor.length <= 512
        ? search.cursor
        : undefined,
  }),
})

function BillingReconciliationRoute() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  const { cursor } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <ReconciliationPage
      {...(cursor ? { cursor } : {})}
      environmentId={environmentId}
      onCursorChange={(nextCursor) => {
        void navigate({ replace: true, search: nextCursor ? { cursor: nextCursor } : {} })
      }}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
