import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"

import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { WorkspacePage } from "@/features/orgs/components/workspace-page"
import { projectQueryOptions } from "@/features/projects/queries/projects-query"

export type MonetizationSurface = "assets" | "experiments" | "paywalls" | "placements" | "releases"

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


export function MonetizationWorkspace({
  actions,
  children,
  description,
  environmentId,
  projectId,
  title,
}: MonetizationWorkspaceProps) {
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
        params={(prev) => prev}
        to="/orgs/$organizationId/projects/$projectId/env/$environmentKey"
      >
        Return to project
      </Link>
    ),
    permissionDescription:
      "Project membership with Environment access is required to manage monetization.",
  })

  return (
    <WorkspacePage
      actions={actions}
      description={description}
      eyebrow={`${project.data?.name ?? "Project"} · ${environment?.name ?? "Environment"}`}
      title={title}
    >
      <HostedResourceBoundary state={state}>
        {children}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
