import { useQuery } from "@tanstack/react-query"

import { sessionQueryOptions } from "@/features/auth/queries/session-query"
import { membersQueryOptions } from "@/features/members/queries/members-query"
import type { Membership } from "@/generated/api"

export function organizationAccessFor(
  actorId: string | undefined,
  memberships: readonly Membership[],
) {
  const membership = memberships.find((candidate) => candidate.actorId === actorId)
  return {
    canManage: membership?.role === "owner" || membership?.role === "admin",
    membership,
    role: membership?.role,
  }
}

export function useOrganizationAccess(organizationId: string) {
  const session = useQuery(sessionQueryOptions())
  const memberships = useQuery({
    ...membersQueryOptions(organizationId),
    enabled: session.isSuccess && organizationId.length > 0,
  })
  const access = organizationAccessFor(session.data?.id, memberships.data?.items ?? [])
  return {
    ...access,
    error: session.error ?? memberships.error,
    isPending: session.isPending || (session.isSuccess && memberships.isPending),
  }
}
