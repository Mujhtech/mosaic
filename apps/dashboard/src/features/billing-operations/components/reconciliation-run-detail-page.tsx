import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { useQuery } from "@tanstack/react-query";

import { buttonVariants } from "@/components/ui/button-variants";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import {
  BillingBoundaryNote,
  DefinitionRow,
  EnvironmentBadges,
  ProviderBadge,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome";
import {
  formatBillingTimestamp,
  formatReportedCount,
  isReportedCount,
  reconciliationStrategyLabel,
  runStatusLabel,
  runTriggerLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import {
  reconciliationRunIsTerminal,
  reconciliationRunQueryOptions,
} from "@/features/billing-operations/queries/reconciliation-queries";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { storeCredentialsQueryOptions } from "@/features/store-connections/queries/store-connection-queries";
import { storeConnectionHref } from "@/lib/routing/workspace-hrefs";

interface ReconciliationRunDetailPageProps {
  environmentId: string;
  organizationId: string;
  projectId: string;
  runId: string;
}

export function ReconciliationRunDetailPage({
  environmentId,
  organizationId,
  projectId,
  runId,
}: ReconciliationRunDetailPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const run = useQuery({
    ...reconciliationRunQueryOptions(projectId, environmentId, runId),
    enabled: scopeReady,
  });
  const credentials = useQuery({
    ...storeCredentialsQueryOptions(projectId),
    enabled: scopeReady,
  });

  const { data } = run;
  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ??
    environmentId;
  const terminal = reconciliationRunIsTerminal(data ?? undefined);
  // The run carries no Store Environment of its own; it is fixed by the
  // credential the run authenticated with, so it is read from there rather
  // than rendered as "Unclassified" on an operator surface.
  const credential = (credentials.data ?? []).find(
    (item) => item.id === data?.credentialId
  );

  const error =
    project.error ?? environments.error ?? run.error ?? credentials.error;
  const state = resolveHostedQueryState({
    emptyDescription:
      "This run is no longer in the recent reconciliation history for this Mosaic Environment.",
    emptyTitle: "Reconciliation run unavailable",
    error,
    isEmpty: run.isSuccess && !data,
    isPending:
      project.isPending ||
      (scopeReady &&
        (environments.isPending || run.isPending || credentials.isPending)),
    loadingDescription: "Loading the reconciliation run.",
    onRetry: () => {
      run.refetch();
    },
    permissionDescription:
      "Organization owner or admin permission is required to read reconciliation runs.",
    scope: { environmentId, organizationId, projectId },
  });

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Reconciliation run unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  const base = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/billing/${encodeURIComponent(environmentId)}`;

  return (
    <WorkspacePage
      actions={
        <a
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href={`${base}/reconciliation`}
        >
          <ArrowLeftIcon aria-hidden /> All runs
        </a>
      }
      description="Progress and outcome for one bounded reconciliation pass."
      eyebrow="Mosaic Billing · Reconciliation run"
      title={data ? `Run ${data.id ?? runId}` : "Reconciliation run"}
    >
      <BillingBoundaryNote />

      <HostedResourceBoundary state={state}>
        {data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ProviderBadge provider={data.provider} />
              <EnvironmentBadges
                mosaicEnvironmentName={environmentName}
                storeEnvironment={credential?.storeEnvironment}
              />
              <StatusPill
                label={runStatusLabel(data.status)}
                tone={(() => {
                  if (data.status === "completed") {
                    return "positive";
                  }
                  if (data.status === "failed") {
                    return "negative";
                  }
                  if (data.status === "partial") {
                    return "attention";
                  }
                  return "neutral";
                })()}
              />
            </div>

            {/* The worker owns progress; the view polls on a bounded interval
                and stops as soon as the run reaches a terminal state. */}
            <section
              aria-live="polite"
              className="rounded border bg-muted/30 p-4"
              role="status"
            >
              <h2 className="font-semibold text-sm">
                {terminal ? "Run finished" : "Run in progress"}
              </h2>
              <p className="mt-1 text-muted-foreground text-sm leading-6">
                {/* Phrased as labelled counts rather than "Examined N records"
                    so an unreported field reads as unreported. The old prose
                    stated "Examined 0 records" for a field the server never
                    sent, which is a false account of what the run did. */}
                {terminal
                  ? `Store records examined: ${formatReportedCount(data.examinedCount)}. Newly ingested: ${formatReportedCount(data.discoveredCount)}. Already recorded: ${formatReportedCount(data.duplicateCount)}. Conflicting with a recorded fact: ${formatReportedCount(data.conflictCount)}. Failed: ${formatReportedCount(data.failureCount)}.`
                  : `Mosaic is walking store history for this window. Store records examined so far: ${formatReportedCount(data.examinedCount)}. This status refreshes automatically.`}
              </p>
              {isReportedCount(data.conflictCount) && data.conflictCount > 0 ? (
                <div className="mt-3 rounded border border-destructive/30 bg-destructive/5 p-3">
                  <p className="font-semibold text-destructive text-sm">
                    {data.conflictCount} discovery contradicted a fact already
                    on record
                  </p>
                  <p className="mt-1 text-muted-foreground text-sm leading-6">
                    Nothing was overwritten — both facts stand — and each
                    conflict also opened a quarantine record for an operator to
                    judge.
                  </p>
                  <a
                    className="mt-2 inline-flex font-semibold text-primary text-sm"
                    href={`${base}/quarantine?status=open`}
                  >
                    Review the conflicts
                  </a>
                </div>
              ) : null}
              {data.status === "failed" || data.status === "partial" ? (
                <div className="mt-3">
                  <p className="text-destructive text-sm" role="alert">
                    The run stopped with code{" "}
                    {data.lastErrorCode ?? "unknown_error"}.
                  </p>
                  <p className="mt-1 text-muted-foreground text-sm leading-6">
                    Recovery is a new run, not a restart of this one: the
                    original stays as the record of what was examined.
                    Re-running the same window is safe — reconciliation is
                    idempotent, so everything discovered twice is deduplicated
                    rather than recorded again — and the run does not report how
                    far through the window it got, so covering the whole window
                    again is also the only reliable option.
                  </p>
                  <a
                    className={`${buttonVariants({ size: "sm", variant: "outline" })} mt-3`}
                    href={`${base}/reconciliation`}
                  >
                    Start a new run over{" "}
                    {`${formatBillingTimestamp(data.windowStart)} → ${formatBillingTimestamp(data.windowEnd)}`}
                  </a>
                </div>
              ) : null}
            </section>

            <WorkflowPanel
              description="Counts link to what the run did. Nothing here was calculated about any person's access."
              title="Run summary"
            >
              <dl>
                <DefinitionRow
                  label="Strategy"
                  value={reconciliationStrategyLabel(data.strategy)}
                />
                <DefinitionRow
                  label="Trigger"
                  value={runTriggerLabel(data.trigger)}
                />
                <DefinitionRow
                  label="Store Server Credential"
                  value={
                    data.credentialId ? (
                      <a
                        className="font-medium text-primary"
                        href={
                          storeConnectionHref(
                            { organizationId, projectId },
                            data.credentialId
                          ) ?? "#"
                        }
                      >
                        {credential?.name ?? data.credentialId}
                      </a>
                    ) : (
                      "—"
                    )
                  }
                />
                <DefinitionRow
                  label="Window"
                  value={`${formatBillingTimestamp(data.windowStart)} → ${formatBillingTimestamp(data.windowEnd)}`}
                />
                <DefinitionRow
                  label="Examined"
                  value={formatReportedCount(data.examinedCount)}
                />
                <DefinitionRow
                  label="Discovered and ingested"
                  value={
                    <a
                      className="font-medium text-primary"
                      href={`${base}/transactions`}
                    >
                      {formatReportedCount(data.discoveredCount)} · open the
                      ledger
                    </a>
                  }
                />
                <DefinitionRow
                  label="Already recorded (deduplicated)"
                  value={formatReportedCount(data.duplicateCount)}
                />
                {/* Distinct from "discovered": a conflict contradicts a fact
                    already on record, which is what Gate 9A asks reconciliation
                    to detect. Both facts stand. */}
                <DefinitionRow
                  label="Conflicting with a recorded fact"
                  value={
                    isReportedCount(data.conflictCount) &&
                    data.conflictCount > 0 ? (
                      <a
                        className="font-medium text-primary"
                        href={`${base}/quarantine?status=open`}
                      >
                        {data.conflictCount} · open quarantine
                      </a>
                    ) : (
                      formatReportedCount(data.conflictCount)
                    )
                  }
                />
                <DefinitionRow
                  label="Failed"
                  value={
                    <a
                      className="font-medium text-primary"
                      href={`${base}/quarantine?status=open`}
                    >
                      {formatReportedCount(data.failureCount)} · open quarantine
                    </a>
                  }
                />
                <DefinitionRow
                  label="Queued"
                  value={formatBillingTimestamp(data.createdAt)}
                />
                <DefinitionRow
                  label="Started"
                  value={formatBillingTimestamp(data.startedAt)}
                />
                <DefinitionRow
                  label="Completed"
                  value={formatBillingTimestamp(data.completedAt)}
                />
              </dl>
            </WorkflowPanel>
          </>
        ) : null}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
