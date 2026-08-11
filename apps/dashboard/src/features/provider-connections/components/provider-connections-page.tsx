import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { useActiveEnvironment } from "@/features/environments/hooks/use-active-environment";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query";
import { ActiveProviderMatrix } from "@/features/provider-connections/components/active-provider-matrix";
import { ConnectAppStoreConnectSheet } from "@/features/provider-connections/components/connect-app-store-connect-sheet";
import { ConnectRevenueCatSheet } from "@/features/provider-connections/components/connect-revenuecat-sheet";
import { ProviderConnectionsList } from "@/features/provider-connections/components/provider-connections-list";
import {
  createAndTestAppStoreConnectMutationOptions,
  createAndTestRevenueCatMutationOptions,
} from "@/features/provider-connections/mutations/provider-connection-mutations";
import {
  activeProviderAssignmentQueryOptions,
  providerConnectionsQueryOptions,
} from "@/features/provider-connections/queries/provider-connection-queries";
import { useOrganizationAccess } from "@/hooks/use-organization-access";

export function ProviderConnectionsPage({
  organizationId,
  projectId,
  returnTo,
}: {
  organizationId: string;
  projectId: string;
  returnTo?: string;
}) {
  const queryClient = useQueryClient();
  const access = useOrganizationAccess(organizationId);
  const { pathEnvironment } = useActiveEnvironment();
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const connections = useQuery({
    ...providerConnectionsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const connectRevenueCat = useMutation(
    createAndTestRevenueCatMutationOptions(projectId, queryClient)
  );
  const connectAppStoreConnect = useMutation(
    createAndTestAppStoreConnectMutationOptions(projectId, queryClient)
  );
  const applicationItems = applications.data?.items ?? [];
  const environmentItems = environments.data?.items ?? [];
  // An unread scope list is not an empty Project. The sheets are told which of
  // the two they are looking at so they never instruct an operator to create a
  // scope that may already exist.
  const retryScopes = () => {
    applications.refetch();
    environments.refetch();
  };
  // Purchase setup acts only on the Environment the address names, so it reads the
  // path Environment the workspace switcher moves rather than a page-local choice.
  const selectedEnvironment = pathEnvironment;
  const assignmentQueries = useQueries({
    queries: applicationItems.map((application) => ({
      ...activeProviderAssignmentQueryOptions(
        selectedEnvironment?.id ?? "unselected",
        application.id
      ),
      enabled: scopeReady && Boolean(selectedEnvironment),
    })),
  });
  const assignmentError = assignmentQueries.find((query) => query.error)?.error;
  const activeAssignments = assignmentQueries.flatMap((query) =>
    query.data ? [query.data] : []
  );
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
    isEmpty:
      scopeReady && environments.isSuccess && environmentItems.length === 0,
    isPending:
      project.isPending ||
      (scopeReady &&
        (applications.isPending ||
          environments.isPending ||
          connections.isPending ||
          access.isPending ||
          (Boolean(selectedEnvironment) &&
            assignmentQueries.some((query) => query.isPending)))),
    loadingDescription: "Loading Application and Environment commerce scopes.",
    onRetry: () => {
      applications.refetch();
      environments.refetch();
      connections.refetch();
      for (const assignment of assignmentQueries) {
        assignment.refetch();
      }
    },
    permissionDescription:
      "Project membership is required to inspect commerce provider configuration.",
  });

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
    );
  }

  return (
    <WorkspacePage
      description="Connect commerce without changing stable Mosaic Product IDs or rebuilding Paywalls."
      eyebrow="Catalog · Project-wide"
      title="Purchase setup"
    >
      <HostedResourceBoundary state={state}>
        {returnTo ? (
          <a
            className="inline-flex font-semibold text-primary text-sm"
            href={returnTo}
          >
            Return to Publish review
          </a>
        ) : null}
        <WorkflowPanel
          description="Provider resolution is scoped to the Environment in the address bar. Switch Environments from the workspace Environment switcher."
          title="Active provider by Application"
        >
          {selectedEnvironment ? (
            <ActiveProviderMatrix
              applications={applicationItems}
              applicationsHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/apps`}
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
            <div className="rounded border border-border border-dashed p-4">
              <p className="font-semibold text-sm">
                No Environment in this address
              </p>
              <p className="mt-1 text-muted-foreground text-sm leading-6">
                Active providers are scoped to one Environment and one
                registered Application. Pick an Environment from the workspace
                Environment switcher to load provider assignments.
              </p>
            </div>
          )}
        </WorkflowPanel>

        <WorkflowPanel
          description="RevenueCat, App Store Connect, and app-owned custom providers use scoped Connections. StoreKit and Google Play Billing are built in and never require a fake server connection."
          title="Connections"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-muted-foreground text-sm">
              Provider credentials are entered once, encrypted by the API, and
              never returned. App Store Connect reads your existing App Store
              catalog; it is not the same thing as StoreKit, which needs no
              connection at all.
            </p>
            {access.canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <ConnectRevenueCatSheet
                  applications={applicationItems}
                  applicationsUnreadable={applications.isError}
                  environments={environmentItems}
                  environmentsUnreadable={environments.isError}
                  onConnect={async (input) => {
                    await connectRevenueCat.mutateAsync(input);
                  }}
                  onRetryScopes={retryScopes}
                  providerBaseHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`}
                />
                <ConnectAppStoreConnectSheet
                  applications={applicationItems}
                  applicationsUnreadable={applications.isError}
                  environments={environmentItems}
                  environmentsUnreadable={environments.isError}
                  onConnect={async (input) => {
                    await connectAppStoreConnect.mutateAsync(input);
                  }}
                  onRetryScopes={retryScopes}
                  providerBaseHref={`/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/catalog/providers`}
                />
              </div>
            ) : (
              <a
                className="font-semibold text-primary text-sm"
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
  );
}
