import { useQuery } from "@tanstack/react-query";
import { restAnalyticsAdapter } from "@/features/analytics/api/rest-analytics-adapter";
import { AnalyticsCollectionPanel } from "@/features/analytics/components/analytics-collection-panel";
import { useAnalyticsRoleState } from "@/features/analytics/hooks/use-analytics-role";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import {
  environmentAlias,
  environmentForAlias,
} from "@/features/environments/types/environment-alias";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";

interface EnvironmentsPageProps {
  /** The Environment the address names, e.g. `prod`. */
  environmentKey: string;
  organizationId: string;
  projectId: string;
}

export function EnvironmentsPage({
  environmentKey,
  organizationId,
  projectId,
}: EnvironmentsPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const items = environments.data?.items ?? [];
  const roleState = useAnalyticsRoleState(organizationId);
  // Analytics collection is Environment-scoped, so the panel describes the
  // Environment the address names rather than the first one in the list.
  const routedEnvironment = environmentForAlias(items, environmentKey);
  const state = resolveHostedQueryState({
    emptyDescription:
      "Every project must retain Development, Staging, and Production. Retry loading this project.",
    emptyTitle: "Default environments unavailable",
    error: project.error ?? environments.error,
    isEmpty: scopeReady && environments.isSuccess && items.length === 0,
    isPending: project.isPending || (scopeReady && environments.isPending),
    loadingDescription: "Loading isolated project environments.",
    onRetry: () => {
      environments.refetch();
    },
    permissionDescription:
      "Project membership is required to view environment metadata.",
  });

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
    );
  }

  return (
    <WorkspacePage
      description="Environments isolate runtime credentials, hosted Drafts, Placements, and published configuration."
      title="Environments"
    >
      <HostedResourceBoundary state={state}>
        <WorkflowPanel
          description="Keys are immutable and unique within this project."
          title="Project environments"
        >
          <ul className="grid gap-3 md:grid-cols-3">
            {items.map((environment) => (
              <li className="rounded border p-4" key={environment.id}>
                <p className="font-semibold">{environment.name}</p>
                <p className="mt-1 font-mono text-muted-foreground text-xs">
                  {environment.key}
                </p>
                <p className="mt-2 text-muted-foreground text-xs capitalize">
                  Mosaic mode · {environment.mode}
                </p>
              </li>
            ))}
          </ul>
        </WorkflowPanel>
        {routedEnvironment ? (
          <AnalyticsCollectionPanel
            adapter={restAnalyticsAdapter}
            environmentName={routedEnvironment.name}
            role={roleState.role}
            roleUnknown={roleState.unknown}
            scope={{
              environmentId: routedEnvironment.id,
              environmentKey: environmentAlias(routedEnvironment),
              organizationId,
              projectId,
            }}
          />
        ) : null}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
