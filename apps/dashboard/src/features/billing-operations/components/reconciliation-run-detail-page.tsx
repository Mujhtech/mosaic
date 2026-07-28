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
import { formatBillingTimestamp } from "@/features/billing-ledger/types/billing-vocabulary"
import {
  reconciliationRunIsTerminal,
  reconciliationRunQueryOptions,
} from "@/features/billing-operations/queries/reconciliation-queries"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"

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

  const data = run.data
  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ?? environmentId
  const terminal = reconciliationRunIsTerminal(data ?? undefined)

  const error = project.error ?? environments.error ?? run.error
  const state = resolveHostedQueryState({
    emptyDescription:
      "This run is no longer in the recent reconciliation history for this Mosaic Environment.",
    emptyTitle: "Reconciliation run unavailable",
    error,
    isEmpty: run.isSuccess && !data,
    isPending: project.isPending || (scopeReady && (environments.isPending || run.isPending)),
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

  const base = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/billing/${encodeURIComponent(environmentId)}`

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
                storeEnvironment={undefined}
              />
              <StatusPill
                label={data.status ?? "queued"}
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
                  ? `Examined ${data.examinedCount ?? 0} store record(s): ${data.discoveredCount ?? 0} newly ingested, ${data.duplicateCount ?? 0} already recorded, ${data.failureCount ?? 0} failed.`
                  : `Mosaic is walking store history for this window. Examined ${data.examinedCount ?? 0} record(s) so far. This status refreshes automatically.`}
              </p>
              {data.status === "failed" || data.status === "partial" ? (
                <div className="mt-3">
                  <p className="text-destructive text-sm" role="alert">
                    The run stopped with code {data.lastErrorCode ?? "unknown_error"}.
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm leading-6">
                    Recovery is a new run over the remaining window, not a restart of this one: the
                    original run stays as the record of what was examined, and everything discovered
                    twice is deduplicated.
                  </p>
                  <a
                    className={`${buttonVariants({ size: "sm", variant: "outline" })} mt-3`}
                    href={`${base}/reconciliation`}
                  >
                    Start a new run
                  </a>
                </div>
              ) : null}
            </section>

            <WorkflowPanel
              description="Counts link to what the run did. Nothing here was calculated about any person's access."
              title="Run summary"
            >
              <dl>
                <DefinitionRow label="Strategy" value={data.strategy ?? "—"} />
                <DefinitionRow label="Trigger" value={data.trigger ?? "—"} />
                <DefinitionRow label="Store Server Credential" value={data.credentialId ?? "—"} />
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
                <DefinitionRow
                  label="Failed"
                  value={
                    <a className="text-primary font-medium" href={`${base}/quarantine`}>
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
