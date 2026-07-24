import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { ActiveProviderMatrix } from "@/features/provider-connections/components/active-provider-matrix"
import { ConnectRevenueCatSheet } from "@/features/provider-connections/components/connect-revenuecat-sheet"
import { ProviderConnectionsList } from "@/features/provider-connections/components/provider-connections-list"
import { createAndTestRevenueCatMutationOptions } from "@/features/provider-connections/mutations/provider-connection-mutations"
import {
  activeProviderAssignmentQueryOptions,
  providerConnectionsQueryOptions,
} from "@/features/provider-connections/queries/provider-connection-queries"
import { explicitPurchaseSetupEnvironment } from "@/features/provider-connections/types/provider-connection-view"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query"
import { useOrganizationAccess } from "@/hooks/use-organization-access"

export function ProviderConnectionsPage({
  environmentId,
  organizationId,
  projectId,
  returnTo,
}: {
  environmentId?: string
  organizationId: string
  projectId: string
  returnTo?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const access = useOrganizationAccess(organizationId)
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
  const selectedEnvironment = explicitPurchaseSetupEnvironment(environmentItems, environmentId)
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
          assignmentQueries.some((query) => query.isPending))),
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
          description="Choose one Mosaic Environment before inspecting or changing provider resolution. Mosaic never assumes Staging or another Environment."
          title="Active provider by Application"
        >
          <label className="flex max-w-sm flex-col gap-2 text-sm font-medium">
            Environment
            <select
              aria-label="Purchase setup Environment"
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/40 h-9 rounded border px-3 text-sm outline-none focus-visible:ring-3"
              onChange={(event) =>
                void navigate({
                  params: { organizationId, projectId },
                  replace: true,
                  search: {
                    environmentId: event.currentTarget.value || undefined,
                    returnTo,
                  },
                  to: "/organizations/$organizationId/projects/$projectId/catalog/providers",
                })
              }
              value={selectedEnvironment?.id ?? ""}
            >
              <option value="">Select Environment</option>
              {environmentItems.map((environment) => (
                <option key={environment.id} value={environment.id}>
                  {environment.name} · {environment.mode}
                </option>
              ))}
            </select>
          </label>
          {selectedEnvironment ? (
            <div className="mt-5">
              <ActiveProviderMatrix
                applicationsHref={`/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/apps`}
                applications={applicationItems}
                assignments={activeAssignments}
                canManage={access.canManage}
                connections={connections.data?.items ?? []}
                environment={selectedEnvironment}
                managementEnabled
                membersHref={`/organizations/${encodeURIComponent(organizationId)}/members`}
                organizationId={organizationId}
                projectId={projectId}
              />
            </div>
          ) : (
            <div className="border-border mt-5 rounded border border-dashed p-4">
              <p className="text-sm font-semibold">Select an Environment</p>
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                Active providers are scoped to one Environment and one registered Application. No
                provider assignment is loaded until you choose the Environment explicitly.
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
                providerBaseHref={`/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`}
              />
            ) : (
              <a
                className="text-primary text-sm font-semibold"
                href={`/organizations/${encodeURIComponent(organizationId)}/members`}
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
