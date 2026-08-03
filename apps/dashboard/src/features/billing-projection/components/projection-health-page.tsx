import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button-variants";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { AUTHORITATIVE_ACCESS_NOTE } from "@/features/billing-customers/types/entitlement-vocabulary";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import {
  BILLING_OPTIONAL_NOTE,
  formatBillingTimestamp,
  formatDurationSeconds,
  formatReportedCount,
  isReportedCount,
  NOT_REPORTED_LABEL,
  reportedCountTone,
} from "@/features/billing-ledger/types/billing-vocabulary";
import { ProjectionReplayPanel } from "@/features/billing-projection/components/projection-replay-panel";
import { createProjectionReplayMutationOptions } from "@/features/billing-projection/mutations/projection-replay-mutations";
import { projectionHealthQueryOptions } from "@/features/billing-projection/queries/projection-health-queries";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import {
  billingHealthHref,
  billingIdentityConflictsHref,
  billingQuarantineHref,
  billingRestoresHref,
  storeConnectionsHref,
} from "@/lib/routing/workspace-hrefs";

interface ProjectionHealthPageProps {
  environmentId: string;
  organizationId: string;
  projectId: string;
}

/**
 * Whether the authoritative answer Mosaic gives about a customer's access is
 * still current.
 *
 * Every number here is a count or a timestamp. Nothing on this page can carry a
 * customer value, an alias digest, a store token, or a secret — which is what
 * makes it safe to leave open on a wall display.
 */
export function ProjectionHealthPage({
  environmentId,
  organizationId,
  projectId,
}: ProjectionHealthPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const access = useOrganizationAccess(organizationId);
  const queryClient = useQueryClient();
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const health = useQuery({
    ...projectionHealthQueryOptions(projectId, environmentId),
    enabled: scopeReady,
  });
  const replay = useMutation(
    createProjectionReplayMutationOptions(projectId, environmentId, queryClient)
  );

  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ??
    environmentId;
  const { data } = health;

  const error = project.error ?? environments.error ?? health.error;
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending:
      project.isPending ||
      (scopeReady && (environments.isPending || health.isPending)),
    loadingDescription: `Loading projection health for the ${environmentName} Mosaic Environment.`,
    onRetry: () => {
      health.refetch();
    },
    permissionDescription:
      "Organization owner or admin permission is required to read projection health.",
    scope: { environmentId, organizationId, projectId },
  });

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Projection health unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  const scope = { environmentId, organizationId, projectId };
  const connectionsHref = storeConnectionsHref(scope) ?? "#";
  const oldestQueued = data?.projectionOldestQueuedAgeSeconds;
  // Depth alone cannot distinguish a busy queue from a stuck one; age can.
  const queueStuck = typeof oldestQueued === "number" && oldestQueued > 900;
  const conflicts = data?.openIdentityConflicts;
  const unknownEntries = data?.unknownEntitlementEntries;

  return (
    <WorkspacePage
      description="Whether the authoritative answer Mosaic gives about a customer's access is still current in this Mosaic Environment. Billing health answers a different question: whether store input is still becoming facts."
      eyebrow="Mosaic Billing · Projection health"
      title="Projection health"
    >
      <p className="text-muted-foreground text-xs leading-5">
        {AUTHORITATIVE_ACCESS_NOTE}
      </p>

      <HostedResourceBoundary state={state}>
        {data?.billingEnabled === false ? (
          <WorkflowPanel title="Mosaic Billing is turned off for this Project">
            <p className="text-sm leading-6">
              No projection runs while billing is off, so Mosaic holds no
              authoritative answer about anyone&rsquo;s access. Every
              Entitlement read answers <strong>Mosaic cannot answer</strong> —
              never <em>inactive</em>. The distinction matters: a caller that
              treats the two as the same revokes access during an outage.
            </p>
            <p className="mt-2 text-muted-foreground text-sm leading-6">
              {BILLING_OPTIONAL_NOTE}
            </p>
            <a className={`${buttonVariants()} mt-4`} href={connectionsHref}>
              Open Mosaic Billing setup
            </a>
          </WorkflowPanel>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Projection queue"
            recovery={
              queueStuck
                ? `The oldest queued projection has waited ${formatDurationSeconds(oldestQueued)}. Committed access state is falling behind the facts.`
                : undefined
            }
            tone={queueStuck ? "attention" : "neutral"}
            value={
              isReportedCount(data?.projectionQueueDepth)
                ? `${data.projectionQueueDepth} queued`
                : NOT_REPORTED_LABEL
            }
          />
          <Metric
            label="Oldest queued projection"
            tone={queueStuck ? "attention" : "neutral"}
            value={formatDurationSeconds(oldestQueued)}
          />
          <Metric
            label="Failed projection jobs"
            tone={reportedCountTone(
              data?.projectionFailedJobs,
              "negative",
              "positive"
            )}
            value={formatReportedCount(data?.projectionFailedJobs)}
          />
          <Metric
            label="Projection failures in the last hour"
            recovery="A rate signal the queue depth cannot give: a queue that drains while failing is still wrong."
            tone={reportedCountTone(
              data?.projectionFailuresLastHour,
              "attention",
              "neutral"
            )}
            value={formatReportedCount(data?.projectionFailuresLastHour)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Customers with stale committed state"
            tone={reportedCountTone(
              data?.staleCustomers,
              "attention",
              "positive"
            )}
            value={formatReportedCount(data?.staleCustomers)}
          />
          <Metric
            label="Never-projected customers"
            recovery="A customer with no committed projection is answered with a valid snapshot carrying no entries and a pending projection status. That is undetermined, not inactive."
            tone={reportedCountTone(
              data?.neverProjectedCustomers,
              "attention",
              "neutral"
            )}
            value={formatReportedCount(data?.neverProjectedCustomers)}
          />
          <Metric
            label="Entries stating undetermined access"
            recovery="How often Mosaic is declining to answer. Rising here means evidence is missing or stale, not that customers are churning."
            tone={reportedCountTone(unknownEntries, "attention", "positive")}
            value={formatReportedCount(unknownEntries)}
          />
          <Metric
            label="Last projection committed"
            tone="neutral"
            value={formatBillingTimestamp(data?.lastProjectionCommittedAt)}
          />
        </div>

        <WorkflowPanel
          description="An identity conflict freezes its disputed subject and grants neither candidate anything. A spike is security-relevant: it can mean someone is probing whether an asserted identifier will attach them to another person's purchases."
          title="Identity"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Open identity conflicts"
              tone={reportedCountTone(conflicts, "negative", "positive")}
              value={formatReportedCount(conflicts)}
            />
            <Metric
              label="Frozen Purchase Lineages"
              tone={reportedCountTone(
                data?.frozenLineages,
                "attention",
                "neutral"
              )}
              value={formatReportedCount(data?.frozenLineages)}
            />
            <Metric
              label="Unresolved Purchase Lineages"
              tone={reportedCountTone(
                data?.unresolvedLineages,
                "attention",
                "neutral"
              )}
              value={formatReportedCount(data?.unresolvedLineages)}
            />
          </div>
        </WorkflowPanel>

        <WorkflowPanel
          description="Restore and webhook delivery are read-only numbers here. Webhook destinations are configured through the API in this phase; there is no webhook management surface in the dashboard."
          title="Restore and delivery backlog"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Restore backlog"
              tone={reportedCountTone(
                data?.restoreBacklog,
                "attention",
                "neutral"
              )}
              value={formatReportedCount(data?.restoreBacklog)}
            />
            <Metric
              label="Failed restore jobs"
              tone={reportedCountTone(
                data?.restoreFailedJobs,
                "negative",
                "positive"
              )}
              value={formatReportedCount(data?.restoreFailedJobs)}
            />
            <Metric
              label="Webhook delivery backlog"
              tone={reportedCountTone(
                data?.webhookDeliveryBacklog,
                "attention",
                "neutral"
              )}
              value={formatReportedCount(data?.webhookDeliveryBacklog)}
            />
            <Metric
              label="Exhausted webhook deliveries"
              recovery="An exhausted delivery means an application backend was never told about a change it may act on. The events themselves are retained."
              tone={reportedCountTone(
                data?.webhookDeliveriesExhausted,
                "negative",
                "positive"
              )}
              value={formatReportedCount(data?.webhookDeliveriesExhausted)}
            />
          </div>
          <p className="mt-3 text-muted-foreground text-xs leading-5">
            {isReportedCount(data?.activeWebhookDestinations)
              ? `${data.activeWebhookDestinations} active webhook destination(s) in this Mosaic Environment.`
              : "The number of active webhook destinations in this Mosaic Environment was not reported."}
          </p>
        </WorkflowPanel>

        <WorkflowPanel
          description="New projections are computed under the active rule version. More than one version recorded with no replay in flight means a promotion was prepared and never run."
          title="Projection rule versions"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric
              label="Active rule version"
              tone="neutral"
              value={String(data?.activeProjectionRuleVersion ?? "—")}
            />
            <Metric
              label="Recorded rule versions"
              tone={
                isReportedCount(data?.projectionRuleVersionCount) &&
                data.projectionRuleVersionCount > 1
                  ? "attention"
                  : "neutral"
              }
              value={formatReportedCount(data?.projectionRuleVersionCount)}
            />
          </div>
          <p className="mt-3 text-muted-foreground text-xs leading-5">
            Observed at {formatBillingTimestamp(data?.observedAt)}.
          </p>
        </WorkflowPanel>

        <ProjectionReplayPanel
          activeRuleVersion={data?.activeProjectionRuleVersion}
          canManage={access.canManage}
          membersHref={`/orgs/${encodeURIComponent(organizationId)}/members`}
          onReplay={(request) => replay.mutateAsync(request)}
        />

        <WorkflowPanel title="Where to look next">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6">
            <li>
              <a
                className="font-semibold text-primary"
                href={billingHealthHref(scope) ?? "#"}
              >
                Billing health
              </a>{" "}
              — whether store input is still becoming facts at all. A stalled
              intake pipeline shows up there first.
            </li>
            <li>
              <a
                className="font-semibold text-primary"
                href={billingQuarantineHref(scope) ?? "#"}
              >
                Quarantine
              </a>{" "}
              — inputs that could not safely proceed. Unresolved Products here
              become undetermined Entitlements above.
            </li>
            <li>
              <a
                className="font-semibold text-primary"
                href={billingIdentityConflictsHref(scope) ?? "#"}
              >
                Identity conflicts
              </a>{" "}
              — inspect disputed customer claims and the Purchase Lineages
              frozen until an operator resolves them.
            </li>
            <li>
              <a
                className="font-semibold text-primary"
                href={billingRestoresHref(scope) ?? "#"}
              >
                Restore jobs
              </a>{" "}
              — inspect validation-pending and failed restore work without
              treating restore as an immediate access decision.
            </li>
          </ul>
        </WorkflowPanel>
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}

function Metric({
  label,
  recovery,
  tone,
  value,
}: {
  label: string;
  recovery?: ReactNode;
  tone: "attention" | "negative" | "neutral" | "positive";
  value: string;
}) {
  return (
    <div className="rounded border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-sm">{value}</p>
      {tone === "attention" || tone === "negative" ? (
        <div className="mt-2">
          <StatusPill
            label={tone === "negative" ? "Needs attention" : "Watch"}
            tone={tone}
          />
        </div>
      ) : null}
      {recovery ? (
        <p className="mt-2 text-muted-foreground text-xs leading-5">
          {recovery}
        </p>
      ) : null}
    </div>
  );
}
