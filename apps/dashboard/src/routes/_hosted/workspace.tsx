import { createFileRoute } from "@tanstack/react-router"

import { RoutePendingState } from "@/components/feedback/route-feedback"

import { WorkspaceHome } from "@/features/organizations/components/workspace-home"

export const Route = createFileRoute("/_hosted/workspace")({
  component: WorkspaceHome,
  pendingComponent: RoutePendingState,
})
