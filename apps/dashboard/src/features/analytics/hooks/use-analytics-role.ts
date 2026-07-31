import { useQuery } from "@tanstack/react-query";

import { sessionQueryOptions } from "@/features/auth/queries/session-query";
import { membersQueryOptions } from "@/features/members/queries/members-query";
import type { AnalyticsRole } from "../types/analytics";

export function useAnalyticsRole(
  organizationId: string
): AnalyticsRole | undefined {
  const session = useQuery(sessionQueryOptions());
  const members = useQuery(membersQueryOptions(organizationId));
  return members.data?.items.find(
    (membership) => membership.actorId === session.data?.id
  )?.role;
}
