import { useQuery } from "@tanstack/react-query";

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import {
  rememberEnvironmentId,
  rememberedEnvironmentId,
  subscribeToActiveEnvironment,
} from "@/features/environments/types/active-environment-store";
import {
  environmentAlias,
  environmentForAlias,
} from "@/features/environments/types/environment-alias";
import { switchEnvironmentPath } from "@/features/environments/types/environment-path";
import { readWorkspaceScope } from "@/features/orgs/types/workspace-navigation";

/**
 * The single place to ask "which Environment am I working in?". Pages and queries
 * read it here instead of threading an environmentId prop down from a route.
 *
 * Precedence is URL, then the remembered choice, then the Project's first
 * Environment. The URL winning is what keeps a shared link honest; the remembered
 * choice is what makes Catalog, Apps, and other Environment-less surfaces able to
 * answer the question at all.
 *
 * `inPath` tells a caller whether the current route actually carries the
 * Environment. Anything that must not act on an inherited Environment — provider
 * and purchase setup, which refuse to default — should require it.
 */
export function useActiveEnvironment() {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const scope = readWorkspaceScope(pathname);
  const projectId = scope.projectId ?? "";

  const query = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: projectId.length > 0,
  });
  // Stable identity: pathFor closes over this, and a fresh array every render would
  // rebuild the callback and every memo downstream of it.
  const items = useMemo(() => query.data?.items ?? [], [query.data?.items]);

  const rememberedId = useSyncExternalStore(
    subscribeToActiveEnvironment,
    () => rememberedEnvironmentId(projectId),
    () => undefined
  );

  // This is the mapping point: the alias in the address resolves to the Environment
  // here, so no page has to know that the API wants an id. Candidates are validated
  // against the Project's own Environments, so neither a stale remembered id nor a
  // malformed segment can be mistaken for a scope.
  const fromPath = environmentForAlias(items, scope.environmentSegment);
  const fromMemory = items.find(
    (environment) => environment.id === rememberedId
  );
  const active = fromPath ?? fromMemory ?? items[0];

  // Visiting an Environment-scoped page is itself a choice; remembering it is what
  // carries the Environment onto the surfaces that have none.
  useEffect(() => {
    if (fromPath) {
      rememberEnvironmentId(projectId, fromPath.id);
    }
  }, [projectId, fromPath]);

  /** Where this route would live under another Environment, or null if it does not name one. */
  const pathFor = useCallback(
    (environmentId: string) => {
      if (!fromPath) {
        return null;
      }
      const next = items.find(
        (environment) => environment.id === environmentId
      );
      if (!next) {
        return null;
      }

      return switchEnvironmentPath(
        pathname,
        environmentAlias(fromPath),
        environmentAlias(next)
      );
    },
    [fromPath, items, pathname]
  );

  /** Records the choice without navigating, for callers that render their own link. */
  const remember = useCallback(
    (environmentId: string) => rememberEnvironmentId(projectId, environmentId),
    [projectId]
  );

  const select = useCallback(
    (environmentId: string) => {
      remember(environmentId);

      // On a route that carries the Environment, the URL is the authority and has
      // to move too, keeping the surface and its search intact.
      const target = pathFor(environmentId);
      if (target) {
        navigate({ search: true, to: target });
      }
    },
    [navigate, pathFor, remember]
  );

  return {
    active,
    activeId: active?.id,
    /**
     * The Environment as an address names it. Components hold ids and routes carry
     * aliases, so this is the translation in the direction links need.
     */
    alias: active ? environmentAlias(active) : "",
    inPath: Boolean(fromPath),
    items,
    /**
     * Only what the address itself names. A route must resolve from this, never from
     * `active`: falling back to a remembered Environment would render one page while
     * the address described another.
     */
    pathEnvironment: fromPath,
    /**
     * What the address wrote in the Environment slot, resolved or not. A caller
     * that must not silently substitute a different Environment compares this
     * against `pathEnvironment`: a segment that is present but unresolved is a
     * wrong address, not an absent one.
     */
    pathSegment: scope.environmentSegment,
    organizationId: scope.organizationId,
    pathFor,
    projectId,
    query,
    remember,
    select,
  };
}
