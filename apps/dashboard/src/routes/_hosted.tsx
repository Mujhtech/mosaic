import { createFileRoute, Outlet } from "@tanstack/react-router"

import { CloudWorkspaceShell } from "@/features/organizations/components/cloud-workspace-shell"

export const Route = createFileRoute("/_hosted")({
  component: HostedLayout,
})

function HostedLayout() {
  return (
    <CloudWorkspaceShell>
      <Outlet />
    </CloudWorkspaceShell>
  )
}
