import { PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/feedback/empty-state";
import { LocalDateTime } from "@/components/feedback/local-date-time";
import { buttonVariants } from "@/components/ui/button-variants";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { MonetizationWorkspace } from "@/features/environments/components/monetization-workspace";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import { workspaceScopeParams } from "@/lib/routing/workspace-params";
import { cn } from "@/lib/utils";
import { useExperimentAdapter } from "../api/use-experiment-adapter";
import { experimentsQueryOptions } from "../queries/experiment-queries";
import { ExperimentStatusBadge } from "./experiment-status";
import { MutualExclusionGroupManager } from "./mutual-exclusion-group-manager";

export function ExperimentsPage({
  environmentId,
  organizationId,
  projectId,
}: {
  environmentId: string;
  organizationId: string;
  projectId: string;
}) {
  const scope = { environmentId, projectId };
  const adapter = useExperimentAdapter();
  const experiments = useQuery(experimentsQueryOptions(scope, adapter));
  const access = useOrganizationAccess(organizationId);
  const state = resolveHostedQueryState({
    emptyDescription: "Create the first Experiment for this Environment.",
    emptyTitle: "No Experiments",
    error: experiments.error,
    isEmpty: false,
    isPending: experiments.isPending,
    loadingDescription: "Loading Environment-scoped Experiments.",
    onRetry: () => {
      experiments.refetch();
    },
    permissionDescription:
      "Environment access is required to inspect Experiments.",
    scope: { environmentId, organizationId, projectId },
  });
  const createLink = access.canManage ? (
    <Link
      className={buttonVariants()}
      params={(prev) => ({
        ...prev,
        ...workspaceScopeParams(prev),
      })}
      to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/new"
    >
      <PlusIcon aria-hidden size={16} /> New Experiment
    </Link>
  ) : undefined;

  return (
    <MonetizationWorkspace
      actions={createLink}
      description="Test exact immutable Paywall Versions with deterministic offline assignment, explicit presentation exposure, safety guardrails, and uncertainty-aware results."
      environmentId={environmentId}
      organizationId={organizationId}
      projectId={projectId}
      surface="experiments"
      title="Experiments"
    >
      <HostedResourceBoundary state={state}>
        {access.canManage ? (
          <MutualExclusionGroupManager scope={scope} />
        ) : null}
        {experiments.data?.length ? (
          <div className="grid gap-3">
            {experiments.data.map((experiment) => (
              <Link
                className="grid gap-3 rounded border p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring md:grid-cols-[1fr_auto]"
                key={experiment.id}
                params={(prev) => ({
                  ...prev,
                  ...workspaceScopeParams(prev),
                  experimentId: experiment.id,
                })}
                to="/orgs/$organizationId/projects/$projectId/env/$environmentKey/monetization/experiments/$experimentId"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{experiment.name}</h2>
                    <ExperimentStatusBadge status={experiment.status} />
                  </div>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {experiment.placementName} ·{" "}
                    {experiment.activeVersionNumber
                      ? `Version ${experiment.activeVersionNumber}`
                      : "Unpublished Draft"}
                  </p>
                </div>
                <p className="self-center text-muted-foreground text-xs">
                  Updated <LocalDateTime value={experiment.updatedAt} />
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            action={createLink}
            description="Create a Draft, choose exact Control and Treatment Paywall Versions, then validate Product and provider safety before publishing."
            title="No Experiments in this Environment"
          />
        )}
        {access.canManage || access.isPending ? null : (
          <p
            className={cn(
              "text-muted-foreground text-sm",
              experiments.data?.length && "mt-3"
            )}
          >
            Members can inspect setup and aggregate results. Owner or admin
            access is required to mutate Experiments or request ordinary raw
            export.
          </p>
        )}
      </HostedResourceBoundary>
    </MonetizationWorkspace>
  );
}
