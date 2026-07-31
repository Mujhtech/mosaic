import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { OrganizationOverviewPage } from "@/features/organizations/components/organization-overview-page"

interface OrganizationSearch {
  projectStatus?: "archived"
}

export const Route = createFileRoute("/_hosted/organizations/$organizationId/")({
  component: OrganizationRoute,
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
