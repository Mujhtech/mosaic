import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"

import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { useActiveEnvironment } from "@/features/environments/hooks/use-active-environment"
import { WorkspacePage, WorkflowPanel } from "@/features/orgs/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
import { ActiveProviderMatrix } from "@/features/provider-connections/components/active-provider-matrix"
import { ConnectRevenueCatSheet } from "@/features/provider-connections/components/connect-revenuecat-sheet"
import { ProviderConnectionsList } from "@/features/provider-connections/components/provider-connections-list"
import { createAndTestRevenueCatMutationOptions } from "@/features/provider-connections/mutations/provider-connection-mutations"
import {
  activeProviderAssignmentQueryOptions,
  providerConnectionsQueryOptions,
} from "@/features/provider-connections/queries/provider-connection-queries"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query"
import { useOrganizationAccess } from "@/hooks/use-organization-access"

export function ProviderConnectionsPage({
  organizationId,
  projectId,
  returnTo,
}: {
  organizationId: string
  projectId: string
  returnTo?: string
}) {
  const queryClient = useQueryClient()
  const access = useOrganizationAccess(organizationId)
  const { pathEnvironment } = useActiveEnvironment()
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: scopeReady,
  })
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  })
  const connections = useQuery({
    ...providerConnectionsQueryOptions(projectId),
    enabled: scopeReady,
  })
  const connectRevenueCat = useMutation(
    createAndTestRevenueCatMutationOptions(projectId, queryClient),
  )
  const applicationItems = applications.data?.items ?? []
  const environmentItems = environments.data?.items ?? []
  // Purchase setup acts only on the Environment the address names, so it reads the
  // path Environment the workspace switcher moves rather than a page-local choice.
  const selectedEnvironment = pathEnvironment
  const assignmentQueries = useQueries({
    queries: applicationItems.map((application) => ({
      ...activeProviderAssignmentQueryOptions(
        selectedEnvironment?.id ?? "unselected",
        application.id,
      ),
      enabled: scopeReady && Boolean(selectedEnvironment),
    })),
  })
  const assignmentError = assignmentQueries.find((query) => query.error)?.error
  const activeAssignments = assignmentQueries.flatMap((query) => (query.data ? [query.data] : []))
  const state = resolveHostedQueryState({
    emptyDescription:
      "A Project needs its default Environments before commerce providers can be scoped safely.",
    emptyTitle: "No Environments available",
    error:
      project.error ??
      applications.error ??
      environments.error ??
      connections.error ??
      access.error ??
      assignmentError,
    isEmpty: scopeReady && environments.isSuccess && environmentItems.length === 0,
    isPending:
      project.isPending ||
      (scopeReady &&
        (applications.isPending ||
          environments.isPending ||
          connections.isPending ||
          access.isPending ||
          (Boolean(selectedEnvironment) && assignmentQueries.some((query) => query.isPending)))),
    loadingDescription: "Loading Application and Environment commerce scopes.",
    onRetry: () => {
      void applications.refetch()
      void environments.refetch()
      void connections.refetch()
      for (const assignment of assignmentQueries) void assignment.refetch()
    },
    permissionDescription:
      "Project membership is required to inspect commerce provider configuration.",
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Purchase setup unavailable in this Organization"
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
      description="Connect commerce without changing stable Mosaic Product IDs or rebuilding Paywalls."
      eyebrow="Catalog · Project-wide"
      title="Purchase setup"
    >
      <HostedResourceBoundary state={state}>
        {returnTo ? (
          <a className="text-primary inline-flex text-sm font-semibold" href={returnTo}>
            Return to Publish review
          </a>
        ) : null}
        <WorkflowPanel
          description="Provider resolution is scoped to the Environment in the address bar. Switch Environments from the workspace Environment switcher."
          title="Active provider by Application"
        >
          {selectedEnvironment ? (
            <ActiveProviderMatrix
              applicationsHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/apps`}
              applications={applicationItems}
              assignments={activeAssignments}
              canManage={access.canManage}
              connections={connections.data?.items ?? []}
              environment={selectedEnvironment}
              managementEnabled
              membersHref={`/orgs/${encodeURIComponent(organizationId)}/members`}
              organizationId={organizationId}
              projectId={projectId}
            />
          ) : (
            <div className="border-border rounded border border-dashed p-4">
              <p className="text-sm font-semibold">No Environment in this address</p>
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                Active providers are scoped to one Environment and one registered Application. Pick
                an Environment from the workspace Environment switcher to load provider assignments.
              </p>
            </div>
          )}
        </WorkflowPanel>

        <WorkflowPanel
          description="RevenueCat and app-owned custom providers use scoped Connections. StoreKit and Google Play Billing are built in and never require a fake server connection."
          title="Connections"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground max-w-2xl text-sm">
              RevenueCat credentials are entered once, encrypted by the API, and never returned.
            </p>
            {access.canManage ? (
              <ConnectRevenueCatSheet
                applications={applicationItems}
                environments={environmentItems}
                onConnect={async (input) => {
                  await connectRevenueCat.mutateAsync(input)
                }}
                providerBaseHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`}
              />
            ) : (
              <a
                className="text-primary text-sm font-semibold"
                href={`/orgs/${encodeURIComponent(organizationId)}/members`}
              >
                Ask an Owner or Admin to connect a provider
              </a>
            )}
          </div>
          <ProviderConnectionsList
            connections={connections.data?.items ?? []}
            organizationId={organizationId}
            projectId={projectId}
          />
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
