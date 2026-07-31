import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { IdentityConflictsPage } from "@/features/billing-customers/components/identity-conflicts-page"
import { useRouteEnvironment } from "@/features/environments/hooks/use-route-environment"
import { routeHead } from "@/lib/routing/route-head"

interface ConflictsSearch {
  status?: "open" | "resolved"
}

export const Route = createFileRoute(
  "/_hosted/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/identity-conflicts/",
)({
  component: IdentityConflictsRoute,
  head: () => routeHead({ title: "Identity conflicts" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): ConflictsSearch => ({
    status: search.status === "resolved" ? "resolved" : undefined,
  }),
})

function IdentityConflictsRoute() {
  const { organizationId, projectId } = Route.useParams()
  const { environmentId, fallback } = useRouteEnvironment()
  const { status } = Route.useSearch()
  const navigate = Route.useNavigate()
  if (!environmentId) return fallback

  return (
    <IdentityConflictsPage
      environmentId={environmentId}
      onStatusChange={(next) => {
        void navigate({ replace: true, search: next === "resolved" ? { status: next } : {} })
      }}
      organizationId={organizationId}
      projectId={projectId}
      status={status ?? "open"}
    />
  )
}
