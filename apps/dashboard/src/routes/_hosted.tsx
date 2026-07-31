import { createFileRoute, Outlet } from "@tanstack/react-router"

import { CloudWorkspaceShell } from "@/features/organizations/components/cloud-workspace-shell"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export const Route = createFileRoute("/_hosted")({
  component: HostedLayout,
})

// {session.error instanceof ApiError && session.error.status === 401 ? (
//             <div className="px-5 pt-5 sm:px-8">
//               <HostedAccessBanner compact />
//             </div>
//           ) : null}

function HostedLayout() {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 55)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <CloudWorkspaceShell />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
