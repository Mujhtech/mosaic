import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { MembersPage } from "@/features/members/components/members-page"
import { routeHead } from "@/lib/routing/route-head"

export const Route = createFileRoute("/_hosted/orgs/$organizationId/members")({
  component: OrganizationMembersRoute,
  head: () => routeHead({ title: "Members" }),
  pendingComponent: RoutePendingState,
})

function OrganizationMembersRoute() {
  const { organizationId } = Route.useParams()

  return <MembersPage organizationId={organizationId} />
}
