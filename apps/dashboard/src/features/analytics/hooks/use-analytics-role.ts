import { useQuery } from "@tanstack/react-query";

import { sessionQueryOptions } from "@/features/auth/queries/session-query";
import { membersQueryOptions } from "@/features/members/queries/members-query";
import type { AnalyticsRole } from "../types/analytics";

export interface AnalyticsRoleState {
  role?: AnalyticsRole;
  /**
   * True while membership has not been read — still loading, or failed. An
   * absent role then means "not established", which is not the same claim as
   * "this actor is not an owner or admin", and a surface must not make the
   * second claim from the first.
   */
  unknown: boolean;
}

export function useAnalyticsRoleState(
  organizationId: string
): AnalyticsRoleState {
  const session = useQuery(sessionQueryOptions());
  const members = useQuery(membersQueryOptions(organizationId));
  const role = members.data?.items.find(
    (membership) => membership.actorId === session.data?.id
  )?.role;

  return {
    ...(role ? { role } : {}),
    unknown: !(session.data && members.data),
  };
}

export function useAnalyticsRole(
  organizationId: string
): AnalyticsRole | undefined {
  return useAnalyticsRoleState(organizationId).role;
}
