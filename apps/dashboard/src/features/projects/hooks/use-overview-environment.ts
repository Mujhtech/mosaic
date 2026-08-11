import { useSyncExternalStore } from "react";

import { useActiveEnvironment } from "@/features/environments/hooks/use-active-environment";
import {
  rememberedEnvironmentId,
  subscribeToActiveEnvironment,
} from "@/features/environments/types/active-environment-store";
import { defaultOverviewEnvironment } from "@/features/projects/types/overview-metrics";

/**
 * Which Environment the overview's metrics describe.
 *
 * Precedence matches the rest of the workspace — the address wins, then the
 * remembered choice, then the preference order — because the overview route
 * carries an Environment segment. Selecting therefore moves the URL as well as
 * recording the choice, so the page never reports one Environment while its
 * address names another.
 */
export function useOverviewEnvironment(projectId: string) {
  const { items, pathEnvironment, pathSegment, query, select } =
    useActiveEnvironment();
  const rememberedId = useSyncExternalStore(
    subscribeToActiveEnvironment,
    () => rememberedEnvironmentId(projectId),
    () => undefined
  );

  // An address that names an Environment this Project does not have is a wrong
  // address, not a missing one. Falling back here would measure one Environment
  // under a heading and a URL that name another, which is the failure the
  // precedence rule exists to prevent — so it refuses to resolve and says so.
  const unresolvedAlias =
    query.isSuccess && pathSegment && !pathEnvironment
      ? pathSegment
      : undefined;

  return {
    items,
    query,
    select,
    selected: unresolvedAlias
      ? undefined
      : (pathEnvironment ?? defaultOverviewEnvironment(items, rememberedId)),
    /** The address's Environment segment, when nothing in the Project matches it. */
    unresolvedAlias,
  };
}
