import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { OrganizationOverviewPage } from "@/features/orgs/components/organization-overview-page"
import { routeHead } from "@/lib/routing/route-head"

interface OrganizationSearch {
  projectStatus?: "archived"
}

export const Route = createFileRoute("/_hosted/orgs/$organizationId/")({
  component: OrganizationRoute,
  head: () => routeHead({ title: "Organization" }),
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): OrganizationSearch => ({
    projectStatus: search.projectStatus === "archived" ? "archived" : undefined,
  }),
})

function OrganizationRoute() {
  const { organizationId } = Route.useParams()
  const { projectStatus } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <OrganizationOverviewPage
      onProjectStatusChange={(nextStatus) => {
        void navigate({
          replace: true,
          search: { projectStatus: nextStatus === "archived" ? "archived" : undefined },
        })
      }}
      organizationId={organizationId}
      projectStatus={projectStatus ?? "active"}
    />
  )
}
