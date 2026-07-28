import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { QuarantinePage } from "@/features/billing-operations/components/quarantine-page"
import type { QuarantineListFilters } from "@/features/billing-operations/queries/quarantine-queries"

const STATUSES = ["open", "retrying", "closed_after_success", "closed_superseded"] as const
const PROVIDERS = ["app_store", "google_play"] as const
const REASON_CODE = /^[a-z_]{1,64}$/

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/quarantine/",
)({
  component: BillingQuarantineRoute,
  pendingComponent: RoutePendingState,
  // Unknown values fall back to "no filter" rather than throwing: a stale link
  // should still render the page it names.
  validateSearch: (search: Record<string, unknown>): QuarantineListFilters => ({
    provider: PROVIDERS.find((value) => value === search.provider),
    reasonCode:
      typeof search.reasonCode === "string" && REASON_CODE.test(search.reasonCode)
        ? search.reasonCode
        : undefined,
    status: STATUSES.find((value) => value === search.status),
  }),
})

function BillingQuarantineRoute() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <QuarantinePage
      environmentId={environmentId}
      filters={filters}
      onFiltersChange={(nextFilters) => {
        void navigate({ replace: true, search: nextFilters })
      }}
      organizationId={organizationId}
      projectId={projectId}
    />
  )
}
