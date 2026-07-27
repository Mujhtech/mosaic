import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { AssetsPage } from "@/features/assets/components/assets-page"
import { safeInternalReturnTo } from "@/features/auth/types/hosted-access"

interface AssetsRouteSearch {
  returnTo?: string
}

export const Route = createFileRoute(
  "/_hosted/organizations/$organizationId/projects/$projectId/monetization/$environmentId/assets",
)({
  component: RouteComponent,
  pendingComponent: RoutePendingState,
  validateSearch: (search: Record<string, unknown>): AssetsRouteSearch => {
    const returnTo = safeInternalReturnTo(search.returnTo, "")
    return returnTo ? { returnTo } : {}
  },
})

function RouteComponent() {
  const { environmentId, organizationId, projectId } = Route.useParams()
  const { returnTo } = Route.useSearch()
  return (
    <AssetsPage
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      returnTo={returnTo}
    />
  )
}
