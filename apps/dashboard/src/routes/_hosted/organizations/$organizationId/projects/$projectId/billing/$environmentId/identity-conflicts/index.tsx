import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { IdentityConflictsPage } from "@/features/billing-customers/components/identity-conflicts-page"

interface ConflictsSearch {
  status?: "open" | "resolved"
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/billing/$environmentId/identity-conflicts/",
)({
  component: IdentityConflictsRoute,
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): ConflictsSearch => ({
    status: search.status === "resolved" ? "resolved" : undefined,
  }),
})

function IdentityConflictsRoute() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  const { status } = Route.useSearch()
  const navigate = Route.useNavigate()

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
