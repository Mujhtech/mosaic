import { useQuery } from "@tanstack/react-query"

import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"

interface EnvironmentsPageProps {
  organizationId: string
  projectId: string
}

export function EnvironmentsPage({ organizationId, projectId }: EnvironmentsPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const items = environments.data?.items ?? []
  const state = resolveHostedQueryState({
    emptyDescription:
      "Every project must retain Development, Staging, and Production. Retry loading this project.",
    emptyTitle: "Default environments unavailable",
    error: project.error ?? environments.error,
    isEmpty: scopeReady && environments.isSuccess && items.length === 0,
    isPending: project.isPending || (scopeReady && environments.isPending),
    loadingDescription: "Loading isolated project environments.",
    onRetry: () => void environments.refetch(),
    permissionDescription: "Project membership is required to view environment metadata.",
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Environments unavailable in this Organization"
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
      description="Environments isolate runtime credentials now and hosted configuration in Gate 3B."
      title="Environments"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel
          description="Keys are immutable and unique within this project."
          title="Project environments"
        >
          <ul className="grid gap-3 md:grid-cols-3">
            {items.map((environment) => (
              <li className="rounded-xl border p-4" key={environment.id}>
                <p className="font-semibold">{environment.name}</p>
                <p className="text-muted-foreground mt-1 font-mono text-xs">{environment.key}</p>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
