import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { WorkspacePage } from "@/features/organizations/components/workspace-page"
import { projectQueryOptions } from "@/features/projects/queries/projects-query"
import { cn } from "@/lib/utils"

export type MonetizationSurface = "assets" | "paywalls" | "placements" | "releases"

interface MonetizationWorkspaceProps {
  actions?: ReactNode
  children: ReactNode
  description: string
  environmentId: string
  organizationId: string
  projectId: string
  surface: MonetizationSurface
  title: string
}

const tabs = [
  { label: "Paywalls", surface: "paywalls" },
  { label: "Placements", surface: "placements" },
  { label: "Assets", surface: "assets" },
  { label: "Publish history", surface: "releases" },
] as const

export function MonetizationWorkspace({
  actions,
  children,
  description,
  environmentId,
  organizationId,
  projectId,
  surface,
  title,
}: MonetizationWorkspaceProps) {
  const navigate = useNavigate()
  const project = useQuery(projectQueryOptions(projectId))
  const environments = useQuery(environmentsQueryOptions(projectId))
  const items = environments.data?.items ?? []
  const environment = items.find((candidate) => candidate.id === environmentId)
  const state = resolveHostedQueryState({
    emptyDescription: "Choose a valid project Environment before managing monetization.",
    emptyTitle: "Environment unavailable",
    error: project.error ?? environments.error,
    isEmpty: environments.isSuccess && !environment,
    isPending: project.isPending || environments.isPending,
    loadingDescription: "Loading the selected monetization Environment.",
    onRetry: () => {
      void project.refetch()
      void environments.refetch()
    },
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={{ organizationId, projectId }}
        to="/organizations/$organizationId/projects/$projectId"
      >
        Return to project
      </Link>
    ),
    permissionDescription:
      "Project membership with Environment access is required to manage monetization.",
  })

  function changeEnvironment(nextEnvironmentId: string) {
    const params = { environmentId: nextEnvironmentId, organizationId, projectId }
    switch (surface) {
      case "assets":
        return navigate({
          params,
          to: "/organizations/$organizationId/projects/$projectId/monetization/$environmentId/assets",
        })
      case "placements":
        return navigate({
          params,
          to: "/organizations/$organizationId/projects/$projectId/monetization/$environmentId/placements",
        })
      case "releases":
        return navigate({
          params,
          to: "/organizations/$organizationId/projects/$projectId/monetization/$environmentId/releases",
        })
      case "paywalls":
        return navigate({
          params,
          to: "/organizations/$organizationId/projects/$projectId/monetization/$environmentId/paywalls",
        })
    }
  }

  return (
    <WorkspacePage
      actions={actions}
      description={description}
      eyebrow={`${project.data?.name ?? "Project"} · ${environment?.name ?? "Environment"}`}
      title={title}
    >
      <HostedResourceBoundary state={state}>
        <div className="border-border bg-muted/20 rounded border p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="flex items-center gap-3 text-sm font-medium">
              Environment
              <select
                aria-label="Monetization Environment"
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 min-w-48 rounded border px-3 text-sm outline-none focus-visible:ring-3"
                onChange={(event) => void changeEnvironment(event.currentTarget.value)}
                value={environmentId}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-muted-foreground text-xs">
              Drafts, bindings, publishing, and history stay isolated to this Environment.
            </p>
          </div>
          <nav aria-label="Monetization" className="mt-3 flex flex-wrap gap-1 border-t pt-3">
            {tabs.map((tab) => {
              const shared = {
                className: cn(
                  "focus-visible:ring-ring rounded px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none",
                  tab.surface === surface
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                ),
                params: { environmentId, organizationId, projectId },
              }
              switch (tab.surface) {
                case "paywalls":
                  return (
                    <Link
                      {...shared}
                      key={tab.surface}
                      to="/organizations/$organizationId/projects/$projectId/monetization/$environmentId/paywalls"
                    >
                      {tab.label}
                    </Link>
                  )
                case "placements":
                  return (
                    <Link
                      {...shared}
                      key={tab.surface}
                      to="/organizations/$organizationId/projects/$projectId/monetization/$environmentId/placements"
                    >
                      {tab.label}
                    </Link>
                  )
                case "assets":
                  return (
                    <Link
                      {...shared}
                      key={tab.surface}
                      to="/organizations/$organizationId/projects/$projectId/monetization/$environmentId/assets"
                    >
                      {tab.label}
                    </Link>
                  )
                case "releases":
                  return (
                    <Link
                      {...shared}
                      key={tab.surface}
                      to="/organizations/$organizationId/projects/$projectId/monetization/$environmentId/releases"
                    >
                      {tab.label}
                    </Link>
                  )
              }
            })}
          </nav>
        </div>
        {children}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
