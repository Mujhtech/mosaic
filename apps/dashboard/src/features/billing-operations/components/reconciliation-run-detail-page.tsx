import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft"
import { useQuery } from "@tanstack/react-query"

import { buttonVariants } from "@/components/ui/button-variants"
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary"
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state"
import {
  BillingBoundaryNote,
  DefinitionRow,
  EnvironmentBadges,
  ProviderBadge,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome"
import {
  formatBillingTimestamp,
  reconciliationStrategyLabel,
  runStatusLabel,
  runTriggerLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import {
  reconciliationRunIsTerminal,
  reconciliationRunQueryOptions,
} from "@/features/billing-operations/queries/reconciliation-queries"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery"
import { WorkspacePage, WorkflowPanel } from "@/features/orgs/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { storeCredentialsQueryOptions } from "@/features/store-connections/queries/store-connection-queries"
import { storeConnectionHref } from "@/lib/routing/workspace-hrefs"

interface ReconciliationRunDetailPageProps {
  environmentId: string
  organizationId: string
  projectId: string
  runId: string
}

export function ReconciliationRunDetailPage({
  environmentId,
  organizationId,
  projectId,
  runId,
}: ReconciliationRunDetailPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const run = useQuery({
    ...reconciliationRunQueryOptions(projectId, environmentId, runId),
    enabled: scopeReady,
  })
  const credentials = useQuery({
    ...storeCredentialsQueryOptions(projectId),
    enabled: scopeReady,
  })

  const data = run.data
  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ?? environmentId
  const terminal = reconciliationRunIsTerminal(data ?? undefined)
  // The run carries no Store Environment of its own; it is fixed by the
  // credential the run authenticated with, so it is read from there rather
  // than rendered as "Unclassified" on an operator surface.
  const credential = (credentials.data ?? []).find((item) => item.id === data?.credentialId)

  const error = project.error ?? environments.error ?? run.error ?? credentials.error
  const state = resolveHostedQueryState({
    emptyDescription:
      "This run is no longer in the recent reconciliation history for this Mosaic Environment.",
    emptyTitle: "Reconciliation run unavailable",
    error,
    isEmpty: run.isSuccess && !data,
    isPending:
      project.isPending ||
      (scopeReady && (environments.isPending || run.isPending || credentials.isPending)),
    loadingDescription: "Loading the reconciliation run.",
    onRetry: () => {
      void run.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to read reconciliation runs.",
    scope: { environmentId, organizationId, projectId },
  })

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
    )
  }

  const base = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/billing/${encodeURIComponent(environmentId)}`

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
                tone={
                  data.status === "completed"
                    ? "positive"
                    : data.status === "failed"
                      ? "negative"
                      : data.status === "partial"
                        ? "attention"
                        : "neutral"
                }
              />
            </div>

            {/* The worker owns progress; the view polls on a bounded interval
                and stops as soon as the run reaches a terminal state. */}
            <section aria-live="polite" className="bg-muted/30 rounded border p-4" role="status">
              <h2 className="text-sm font-semibold">
                {terminal ? "Run finished" : "Run in progress"}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                {terminal
                  ? `Examined ${data.examinedCount ?? 0} store record(s): ${data.discoveredCount ?? 0} newly ingested, ${data.duplicateCount ?? 0} already recorded, ${data.conflictCount ?? 0} conflicting with a recorded fact, ${data.failureCount ?? 0} failed.`
                  : `Mosaic is walking store history for this window. Examined ${data.examinedCount ?? 0} record(s) so far. This status refreshes automatically.`}
              </p>
              {(data.conflictCount ?? 0) > 0 ? (
                <div className="border-destructive/30 bg-destructive/5 mt-3 rounded border p-3">
                  <p className="text-destructive text-sm font-semibold">
                    {data.conflictCount} discovery contradicted a fact already on record
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm leading-6">
                    Nothing was overwritten — both facts stand — and each conflict also opened a
                    quarantine record for an operator to judge.
                  </p>
                  <a
                    className="text-primary mt-2 inline-flex text-sm font-semibold"
                    href={`${base}/quarantine?status=open`}
                  >
                    Review the conflicts
                  </a>
                </div>
              ) : null}
              {data.status === "failed" || data.status === "partial" ? (
                <div className="mt-3">
                  <p className="text-destructive text-sm" role="alert">
                    The run stopped with code {data.lastErrorCode ?? "unknown_error"}.
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm leading-6">
                    Recovery is a new run, not a restart of this one: the original stays as the
                    record of what was examined. Re-running the same window is safe — reconciliation
                    is idempotent, so everything discovered twice is deduplicated rather than
                    recorded again — and the run does not report how far through the window it got,
                    so covering the whole window again is also the only reliable option.
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
                <DefinitionRow label="Trigger" value={runTriggerLabel(data.trigger)} />
                <DefinitionRow
                  label="Store Server Credential"
                  value={
                    data.credentialId ? (
                      <a
                        className="text-primary font-medium"
                        href={
                          storeConnectionHref({ organizationId, projectId }, data.credentialId) ??
                          "#"
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
                <DefinitionRow label="Examined" value={String(data.examinedCount ?? 0)} />
                <DefinitionRow
                  label="Discovered and ingested"
                  value={
                    <a className="text-primary font-medium" href={`${base}/transactions`}>
                      {data.discoveredCount ?? 0} · open the ledger
                    </a>
                  }
                />
                <DefinitionRow
                  label="Already recorded (deduplicated)"
                  value={String(data.duplicateCount ?? 0)}
                />
                {/* Distinct from "discovered": a conflict contradicts a fact
                    already on record, which is what Gate 9A asks reconciliation
                    to detect. Both facts stand. */}
                <DefinitionRow
                  label="Conflicting with a recorded fact"
                  value={
                    (data.conflictCount ?? 0) > 0 ? (
                      <a
                        className="text-primary font-medium"
                        href={`${base}/quarantine?status=open`}
                      >
                        {data.conflictCount} · open quarantine
                      </a>
                    ) : (
                      "0"
                    )
                  }
                />
                <DefinitionRow
                  label="Failed"
                  value={
                    <a className="text-primary font-medium" href={`${base}/quarantine?status=open`}>
                      {data.failureCount ?? 0} · open quarantine
                    </a>
                  }
                />
                <DefinitionRow label="Queued" value={formatBillingTimestamp(data.createdAt)} />
                <DefinitionRow label="Started" value={formatBillingTimestamp(data.startedAt)} />
                <DefinitionRow label="Completed" value={formatBillingTimestamp(data.completedAt)} />
              </dl>
            </WorkflowPanel>
          </>
        ) : null}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
