import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { WorkspaceEntryRedirect } from "@/features/orgs/components/workspace-entry-redirect"

export const Route = createFileRoute("/_hosted/workspace")({
  // The entry decision deliberately lives in the component, not in beforeLoad:
  // see WorkspaceEntryRedirect for why a client-only beforeLoad never runs on a
  // hard load.
  component: WorkspaceEntryRedirect,
  pendingComponent: RoutePendingState,
})
