import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { detectNestedScopeMismatch } from "@/features/organizations/types/nested-scope"
import { projectLifecycleMutationOptions } from "@/features/projects/mutations/project-mutations"
import {
  applicationsQueryOptions,
  projectQueryOptions,
} from "@/features/projects/queries/projects-query"

interface ProjectOverviewPageProps {
  organizationId: string
  projectId: string
}

export function ProjectOverviewPage({ organizationId, projectId }: ProjectOverviewPageProps) {
  const queryClient = useQueryClient()
  const project = useQuery(projectQueryOptions(projectId))
  const scopeMismatch = detectNestedScopeMismatch({
    expectedOrganizationId: organizationId,
    expectedProjectId: projectId,
    project: project.data,
  })
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: project.isSuccess && scopeMismatch === null,
  })
  const archive = useMutation(projectLifecycleMutationOptions(queryClient, "archive"))
  const restore = useMutation(projectLifecycleMutationOptions(queryClient, "restore"))
  const state = resolveHostedQueryState({
    emptyDescription: "Project data is unavailable.",
    emptyTitle: "Project not found",
    error: project.error,
    isEmpty: project.isSuccess && !project.data,
    isPending: project.isPending,
    loadingDescription: "Loading project workspace.",
    onRetry: () => void project.refetch(),
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={{ organizationId }}
        to="/organizations/$organizationId"
      >
        Return to Organization
      </Link>
    ),
    permissionDescription: "Organization membership is required to read this project.",
  })
  const isArchived = project.data?.status === "archived"

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization and loaded Project do not share the same parent scope."
        title="Project unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      actions={
        isArchived ? (
          <Button
            disabled={restore.isPending}
            onClick={() => restore.mutate(projectId)}
            variant="outline"
          >
            <ArrowCounterClockwiseIcon aria-hidden size={16} />
            Restore project
          </Button>
        ) : (
          <Button
            disabled={archive.isPending}
            onClick={() => archive.mutate(projectId)}
            variant="outline"
          >
            <ArchiveIcon aria-hidden size={16} />
            Archive project
          </Button>
        )
      }
      description="Applications and Catalog are project-wide. Environment scope appears only where runtime isolation matters."
      eyebrow={isArchived ? "Archived project" : "Project workspace"}
      title={project.data?.name ?? "Project"}
    >
      <HostedResourceBoundary state={state}>
        <div className="grid gap-4 md:grid-cols-3">
          <Link
            className="hover:bg-muted/35 rounded-xl border p-5"
            params={{ organizationId, projectId }}
            to="/organizations/$organizationId/projects/$projectId/apps"
          >
            <span className="text-sm font-semibold">Applications</span>
            <span className="text-muted-foreground mt-2 block text-sm">
              {applications.data?.items.length ?? 0} registered iOS or Android apps
            </span>
          </Link>
          <Link
            className="hover:bg-muted/35 rounded-xl border p-5"
            params={{ organizationId, projectId }}
            to="/organizations/$organizationId/projects/$projectId/catalog/plans"
          >
            <span className="text-sm font-semibold">Catalog</span>
            <span className="text-muted-foreground mt-2 block text-sm">
              Plans, Products, and Entitlement definitions
            </span>
          </Link>
          <Link
            className="hover:bg-muted/35 rounded-xl border p-5"
            params={{ organizationId, projectId }}
            to="/organizations/$organizationId/projects/$projectId/settings/environments"
          >
            <span className="text-sm font-semibold">Environments</span>
            <span className="text-muted-foreground mt-2 block text-sm">
              Development, Staging, and Production isolation
            </span>
          </Link>
        </div>
        {archive.error || restore.error ? (
          <p className="text-destructive text-sm" role="alert">
            {(archive.error ?? restore.error)?.message}
          </p>
        ) : null}
        <WorkflowPanel title="Hosted publishing">
          <p className="text-muted-foreground text-sm leading-6">
            Drafts, versions, releases, Publish, rollback, remote configuration delivery, and CDN
            behavior belong to Gate 3B and are intentionally absent.
          </p>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
