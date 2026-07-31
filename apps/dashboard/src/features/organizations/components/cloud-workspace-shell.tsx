import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr/Buildings"
import { CodeIcon } from "@phosphor-icons/react/dist/ssr/Code"
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix"
import { KeyIcon } from "@phosphor-icons/react/dist/ssr/Key"
import { PackageIcon } from "@phosphor-icons/react/dist/ssr/Package"
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour"
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree"
import { Link, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { HostedAccessBanner } from "@/features/auth/components/hosted-access-banner"
import {
  isProjectWideSurface,
  readWorkspaceScope,
} from "@/features/organizations/types/workspace-navigation"

interface WorkspaceNavLinkProps {
  children: ReactNode
  icon: ReactNode
  params?: Record<string, string>
  to: string
}

function WorkspaceNavLink({ children, icon, params, to }: WorkspaceNavLinkProps) {
  return (
    <Link
      activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
      className="text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
      params={params}
      to={to}
    >
      {icon}
      <span>{children}</span>
    </Link>
  )
}

export function CloudWorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const scope = readWorkspaceScope(pathname)
  const showProjectNavigation = Boolean(scope.organizationId && scope.projectId)

  return (
    <div className="bg-background flex h-svh min-h-0 overflow-hidden">
      <a
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        href="#cloud-main"
      >
        Skip to cloud workspace
      </a>
      <aside className="bg-sidebar text-sidebar-foreground hidden w-64 shrink-0 border-r md:flex md:flex-col">
        <div className="flex h-16 items-center gap-3 border-b px-5">
          <span className="bg-sidebar-primary text-sidebar-primary-foreground grid size-9 place-items-center rounded-lg">
            <SquaresFourIcon aria-hidden size={19} weight="fill" />
          </span>
          <span>
            <span className="block text-sm font-semibold">Mosaic</span>
            <span className="text-sidebar-foreground/65 block text-xs">Cloud workspace</span>
          </span>
        </div>
        <nav aria-label="Cloud workspace" className="flex-1 space-y-5 overflow-y-auto p-3">
          <div className="space-y-1">
            <p className="text-sidebar-foreground/55 px-3 py-1 text-xs font-semibold tracking-wide uppercase">
              Workspace
            </p>
            <WorkspaceNavLink icon={<BuildingsIcon aria-hidden size={18} />} to="/workspace">
              Organizations
            </WorkspaceNavLink>
            {scope.organizationId ? (
              <WorkspaceNavLink
                icon={<UsersThreeIcon aria-hidden size={18} />}
                params={{ organizationId: scope.organizationId }}
                to="/organizations/$organizationId/members"
              >
                Members
              </WorkspaceNavLink>
            ) : null}
          </div>
          {showProjectNavigation ? (
            <div className="space-y-1">
              <p className="text-sidebar-foreground/55 px-3 py-1 text-xs font-semibold tracking-wide uppercase">
                Project
              </p>
              <WorkspaceNavLink
                icon={<SquaresFourIcon aria-hidden size={18} />}
                params={{ organizationId: scope.organizationId!, projectId: scope.projectId! }}
                to="/organizations/$organizationId/projects/$projectId"
              >
                Overview
              </WorkspaceNavLink>
              <WorkspaceNavLink
                icon={<CodeIcon aria-hidden size={18} />}
                params={{ organizationId: scope.organizationId!, projectId: scope.projectId! }}
                to="/organizations/$organizationId/projects/$projectId/apps"
              >
                Apps
              </WorkspaceNavLink>
              <WorkspaceNavLink
                icon={<PackageIcon aria-hidden size={18} />}
                params={{ organizationId: scope.organizationId!, projectId: scope.projectId! }}
                to="/organizations/$organizationId/projects/$projectId/catalog/plans"
              >
                Catalog
              </WorkspaceNavLink>
              <WorkspaceNavLink
                icon={<GearSixIcon aria-hidden size={18} />}
                params={{ organizationId: scope.organizationId!, projectId: scope.projectId! }}
                to="/organizations/$organizationId/projects/$projectId/settings/environments"
              >
                Settings
              </WorkspaceNavLink>
              <WorkspaceNavLink
                icon={<KeyIcon aria-hidden size={18} />}
                params={{ organizationId: scope.organizationId!, projectId: scope.projectId! }}
                to="/organizations/$organizationId/projects/$projectId/settings/api-keys"
              >
                API keys
              </WorkspaceNavLink>
            </div>
          ) : null}
        </nav>
        <div className="border-t p-3">
          <WorkspaceNavLink icon={<CodeIcon aria-hidden size={18} />} to="/studio">
            Local Studio
          </WorkspaceNavLink>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 flex min-h-16 flex-wrap items-center gap-3 border-b px-5 py-3 backdrop-blur sm:px-8">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {scope.organizationId ? `Organization · ${scope.organizationId}` : "Organizations"}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {scope.projectId ? `Project · ${scope.projectId}` : "Choose a project to continue"}
            </p>
          </div>
          {isProjectWideSurface(pathname) ? (
            <span className="border-border bg-muted/60 text-muted-foreground rounded-full border px-2.5 py-1 text-xs font-medium">
              Project-wide
            </span>
          ) : null}
          <Link
            className="text-muted-foreground hover:text-foreground text-sm font-medium"
            to="/login"
          >
            Sign in
          </Link>
        </header>
        <div className="px-5 pt-5 sm:px-8">
          <HostedAccessBanner compact />
        </div>
        <main className="min-h-0 flex-1 overflow-y-auto" id="cloud-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  )
}
