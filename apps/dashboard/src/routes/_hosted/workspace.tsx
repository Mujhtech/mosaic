import { createFileRoute } from "@tanstack/react-router"

import { WorkspaceHome } from "@/features/organizations/components/workspace-home"

export const Route = createFileRoute("/_hosted/workspace")({
  component: WorkspaceHome,
})
