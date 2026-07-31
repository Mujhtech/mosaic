import { createFileRoute } from "@tanstack/react-router"

import { MembersPage } from "@/features/members/components/members-page"

export const Route = createFileRoute("/_hosted/organizations/$organizationId/members")({
  component: OrganizationMembersRoute,
})

function OrganizationMembersRoute() {
  const { organizationId } = Route.useParams()

  return <MembersPage organizationId={organizationId} />
}
