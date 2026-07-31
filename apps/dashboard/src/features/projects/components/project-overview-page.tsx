import { ArchiveIcon } from "@phosphor-icons/react/dist/ssr/Archive"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import {
  ApiErrorDetails,
  HostedResourceBoundary,
  RequestIdCopy,
} from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { WorkspacePage, WorkflowPanel } from "@/features/orgs/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
import { detectNestedScopeMismatch } from "@/features/orgs/types/nested-scope"
import { projectLifecycleMutationOptions } from "@/features/projects/mutations/project-mutations"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import {
  applicationsQueryOptions,
  projectQueryOptions,
} from "@/features/projects/queries/projects-query"
import { describeApiError } from "@/lib/api/errors"

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
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: project.isSuccess && scopeMismatch === null,
  })
  const archive = useMutation(projectLifecycleMutationOptions(queryClient, "archive"))
  const restore = useMutation(projectLifecycleMutationOptions(queryClient, "restore"))
  // Archive and restore previously rendered the raw server message, which can
  // carry database internals. Mosaic-owned copy plus the correlation ID is the
  // documented support path.
  const lifecycleError = archive.error ?? restore.error
  const lifecycleFailure = lifecycleError
    ? describeApiError(lifecycleError, { organizationId, projectId })
    : null
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
        to="/orgs/$organizationId"
      >
        Return to Organization
      </Link>
    ),
    permissionDescription: "Organization membership is required to read this project.",
  })
  const isArchived = project.data?.status === "archived"
  const monetizationEnvironment =
    environments.data?.items.find((environment) => environment.key === "staging") ??
    environments.data?.items.find((environment) => environment.key === "development") ??
    environments.data?.items[0]

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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Link
            className="hover:bg-muted/35 rounded border p-5"
            params={(prev) => prev}
            to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/apps"
          >
            <span className="text-sm font-semibold">Applications</span>
            <span className="text-muted-foreground mt-2 block text-sm">
              {applications.data?.items.length ?? 0} registered iOS or Android apps
            </span>
          </Link>
          {monetizationEnvironment ? (
            <Link
              className="hover:bg-muted/35 rounded border p-5"
              params={(prev) => prev}
              to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/paywalls"
            >
              <span className="text-sm font-semibold">Monetization</span>
              <span className="text-muted-foreground mt-2 block text-sm">
                Paywalls, Placements, Assets, and Publish history in {monetizationEnvironment.name}
              </span>
            </Link>
          ) : null}
          <Link
            className="hover:bg-muted/35 rounded border p-5"
            params={(prev) => prev}
            to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/catalog/plans"
          >
            <span className="text-sm font-semibold">Catalog</span>
            <span className="text-muted-foreground mt-2 block text-sm">
              Plans, Products, and Entitlement definitions
            </span>
          </Link>
          <Link
            className="hover:bg-muted/35 rounded border p-5"
            params={(prev) => prev}
            to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/billing/migrations"
          >
            <span className="text-sm font-semibold">Migration Programs</span>
            <span className="text-muted-foreground mt-2 block text-sm">
              Move billing history through mapping, import, comparison, and readiness
            </span>
          </Link>
          <Link
            className="hover:bg-muted/35 rounded border p-5"
            params={(prev) => prev}
            to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/settings/environments"
          >
            <span className="text-sm font-semibold">Environments</span>
            <span className="text-muted-foreground mt-2 block text-sm">
              Development, Staging, and Production isolation
            </span>
          </Link>
        </div>
        {lifecycleFailure ? (
          <div className="space-y-2">
            <p className="text-destructive text-sm" role="alert">
              {lifecycleFailure.description}
            </p>
            <ApiErrorDetails details={lifecycleFailure.details} />
            {lifecycleFailure.correlationId ? (
              <RequestIdCopy requestId={lifecycleFailure.correlationId} />
            ) : null}
          </div>
        ) : null}
        <WorkflowPanel title="Hosted publishing">
          <p className="text-muted-foreground text-sm leading-6">
            Choose a named Environment in Monetization to create hosted Drafts, bind Placements,
            review publish readiness, and restore immutable Releases.
          </p>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
