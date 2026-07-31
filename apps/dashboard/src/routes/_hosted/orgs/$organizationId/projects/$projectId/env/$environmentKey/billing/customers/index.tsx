import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { BillingCustomersPage } from "@/features/billing-customers/components/billing-customers-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"
import { routeHead } from "@/lib/routing/route-head"

interface CustomersSearch {
  conflictedOnly?: boolean
  cursor?: string
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/customers/",
)({
  component: BillingCustomersRoute,
  head: () => routeHead({ title: "Customers" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): CustomersSearch => ({
    conflictedOnly:
      search.conflictedOnly === true || search.conflictedOnly === "true" ? true : undefined,
    cursor:
      typeof search.cursor === "string" && search.cursor.length > 0 && search.cursor.length <= 512
        ? search.cursor
        : undefined,
  }),
})

function BillingCustomersRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  const { conflictedOnly, cursor } = Route.useSearch()
  const navigate = Route.useNavigate()
  if (!environmentId) return fallback

  return (
    <BillingCustomersPage
      {...(conflictedOnly ? { conflictedOnly } : {})}
      {...(cursor ? { cursor } : {})}
      environmentId={environmentId}
      onCustomerFound={(customerId) => {
        void navigate({
          params: (prev) => ({ ...prev, customerId }),
          search: {},
          to: "/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/customers/$customerId",
        })
      }}
      onFiltersChange={(filters) => {
        void navigate({
          replace: true,
          search: {
            ...(filters.conflictedOnly ? { conflictedOnly: true } : {}),
            ...(filters.cursor ? { cursor: filters.cursor } : {}),
          },
        })
      }}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
