import * as React from "react"

import { useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"

import { RoutePendingState } from "@/components/feedback/route-feedback"
import { WorkspaceHome } from "@/features/orgs/components/workspace-home"
import {
  resolveWorkspaceEntry,
  workspaceEntryNavigation,
} from "@/features/orgs/types/workspace-entry"
import { workspaceBootstrapQueryOptions } from "@/features/orgs/queries/workspace-bootstrap-query"

/**
 * Entry resolves here rather than in the route's beforeLoad. The session lives in
 * an HttpOnly cookie the SSR pass cannot read, so the guard has to be
 * client-side; but a beforeLoad that returns early under `import.meta.env.SSR`
 * runs only on the server for a hard load, and Start does not re-run it after
 * hydration. The redirect silently never happened. A component runs on every
 * hydration, so this holds for both a typed URL and an in-app navigation.
 */
export function WorkspaceEntryRedirect() {
  const navigate = useNavigate()
  const bootstrap = useQuery(workspaceBootstrapQueryOptions())

  // Memoised on the cached snapshot: resolveWorkspaceEntry returns a fresh
  // object each call, which would re-arm the effect on every render.
  const target = React.useMemo(
    () => (bootstrap.data ? resolveWorkspaceEntry(bootstrap.data) : undefined),
    [bootstrap.data],
  )

  React.useEffect(() => {
    if (!target) return
    // Replaced, not pushed: Back must leave the workspace rather than land on
    // this route again and bounce forward.
    void navigate({ ...workspaceEntryNavigation(target), replace: true })
  }, [navigate, target])

  // A failed bootstrap must not strand the operator on a blank redirect. The
  // Organization list reports the outage and offers a retry.
  if (bootstrap.isError) return <WorkspaceHome />

  return <RoutePendingState />
}
