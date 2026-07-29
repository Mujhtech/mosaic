import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { BillingCustomersPage } from "@/features/billing-customers/components/billing-customers-page"

interface CustomersSearch {
  conflictedOnly?: boolean
  cursor?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/customers/",
)({
  component: BillingCustomersRoute,
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
  const { environmentId, organizationId, projectId } = Route.useParams()
  const { conflictedOnly, cursor } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <BillingCustomersPage
      {...(conflictedOnly ? { conflictedOnly } : {})}
      {...(cursor ? { cursor } : {})}
      environmentId={environmentId}
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
