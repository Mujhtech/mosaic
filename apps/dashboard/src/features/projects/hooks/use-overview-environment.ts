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
  const { items, pathEnvironment, query, select } = useActiveEnvironment();
  const rememberedId = useSyncExternalStore(
    subscribeToActiveEnvironment,
    () => rememberedEnvironmentId(projectId),
    () => undefined
  );

  return {
    items,
    query,
    select,
    selected:
      pathEnvironment ?? defaultOverviewEnvironment(items, rememberedId),
  };
}
