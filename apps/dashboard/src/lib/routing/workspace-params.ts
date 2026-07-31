import { DEFAULT_ENVIRONMENT_ALIAS } from "@/features/environments/types/environment-alias";

type RouteParams = Record<string, string | undefined>;

/**
 * TanStack types every param inherited from a parent route as optional, but the
 * workspace routes under
 * /orgs/$organizationId/projects/$projectId/env/$environmentKey always carry
 * these three. Re-reading them here gives child routes the required types
 * without a non-null assertion at each of the ~40 call sites; the values are
 * passed through untouched, so navigation behaviour is unchanged.
 */
export function workspaceScopeParams(prev: RouteParams) {
  return {
    environmentKey: prev.environmentKey,
    organizationId: prev.organizationId,
    projectId: prev.projectId,
  } as { environmentKey: string; organizationId: string; projectId: string };
}

/**
 * For links minted from an address that need not name an Environment — the
 * Organization overview, for instance — falling back to the Environment every
 * Project is guaranteed to have. Without this the target is unresolvable and the
 * link renders with no href at all. Matches how workspace entry addresses a
 * Project it has not yet read an Environment list for.
 */
export function workspaceScopeParamsWithDefault(prev: RouteParams) {
  return {
    ...workspaceScopeParams(prev),
    environmentKey: prev.environmentKey ?? DEFAULT_ENVIRONMENT_ALIAS,
  };
}

/**
 * The Studio routes carry the Organization and Project the same way, but key
 * Environments by id rather than key, so those params are supplied explicitly.
 */
export function studioScopeParams(prev: RouteParams) {
  return {
    organizationId: prev.organizationId,
    projectId: prev.projectId,
  } as { organizationId: string; projectId: string };
}
