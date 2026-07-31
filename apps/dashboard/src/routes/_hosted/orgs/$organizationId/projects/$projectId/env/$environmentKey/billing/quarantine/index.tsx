import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { QuarantinePage } from "@/features/billing-operations/components/quarantine-page"
import type { QuarantineListFilters } from "@/features/billing-operations/queries/quarantine-queries"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"
import { routeHead } from "@/lib/routing/route-head"

const STATUSES = ["open", "retrying", "closed_after_success", "closed_superseded"] as const
const PROVIDERS = ["app_store", "google_play"] as const
const REASON_CODE = /^[a-z_]{1,64}$/

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/quarantine/",
)({
  component: BillingQuarantineRoute,
  head: () => routeHead({ title: "Quarantine" }),
  pendingComponent: RoutePendingState,
  // Unknown values fall back to "no filter" rather than throwing: a stale link
  // should still render the page it names.
  validateSearch: (search: Record<string, unknown>): QuarantineListFilters => ({
    cursor:
      typeof search.cursor === "string" && search.cursor.length > 0 && search.cursor.length <= 512
        ? search.cursor
        : undefined,
    provider: PROVIDERS.find((value) => value === search.provider),
    reasonCode:
      typeof search.reasonCode === "string" && REASON_CODE.test(search.reasonCode)
        ? search.reasonCode
        : undefined,
    status: STATUSES.find((value) => value === search.status),
  }),
})

function BillingQuarantineRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  const filters = Route.useSearch()
  const navigate = Route.useNavigate()
  if (!environmentId) return fallback

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
