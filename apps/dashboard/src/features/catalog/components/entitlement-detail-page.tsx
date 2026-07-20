import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { CatalogTabs } from "@/features/catalog/components/catalog-tabs"
import { entitlementQueryOptions } from "@/features/catalog/queries/catalog-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { detectNestedScopeMismatch } from "@/features/organizations/types/nested-scope"
import { projectQueryOptions } from "@/features/projects/queries/projects-query"

interface EntitlementDetailPageProps {
  entitlementId: string
  organizationId: string
  projectId: string
}

export function EntitlementDetailPage({
  entitlementId,
  organizationId,
  projectId,
}: EntitlementDetailPageProps) {
  const project = useQuery(projectQueryOptions(projectId))
  const entitlement = useQuery(entitlementQueryOptions(entitlementId))
  const scopeMismatch = detectNestedScopeMismatch({
    expectedOrganizationId: organizationId,
    expectedProjectId: projectId,
    expectedResourceId: entitlementId,
    project: project.data,
    resource: entitlement.data,
  })
  const state = resolveHostedQueryState({
    emptyDescription: "Return to Entitlements and choose an existing definition.",
    emptyTitle: "Entitlement unavailable",
    error: project.error ?? entitlement.error,
    isEmpty: entitlement.isSuccess && !entitlement.data,
    isPending: project.isPending || entitlement.isPending,
    loadingDescription: "Loading Entitlement definition.",
    onRetry: () => void entitlement.refetch(),
    permissionAction: (
      <Link
        className={buttonVariants({ variant: "outline" })}
        params={{ organizationId, projectId }}
        to="/organizations/$organizationId/projects/$projectId"
      >
        Return to Project
      </Link>
    ),
    permissionDescription: "Project membership is required to view this Entitlement definition.",
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed parent identifiers do not match this Entitlement definition."
        title="Entitlement unavailable in this Project"
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
      description={entitlement.data?.description ?? "Project-wide access definition."}
      eyebrow="Catalog · Entitlement definition"
      title={entitlement.data?.name ?? "Entitlement"}
    >
      <CatalogTabs organizationId={organizationId} projectId={projectId} />
      <HostedResourceBoundary state={state}>
        <WorkflowPanel title="Definition">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs uppercase">Key</dt>
              <dd className="mt-1 font-mono text-sm">{entitlement.data?.key}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase">Stable ID</dt>
              <dd className="mt-1 font-mono text-sm">{entitlement.data?.id}</dd>
            </div>
          </dl>
          <p className="border-border bg-muted/40 mt-5 rounded-lg border p-4 text-sm leading-6">
            This record defines access that Products can grant. It is not an authoritative customer
            Entitlement, receipt, subscription state, or entitlement check.
          </p>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
