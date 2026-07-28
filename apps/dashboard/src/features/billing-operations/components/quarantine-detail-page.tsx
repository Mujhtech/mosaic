import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

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
import { ValidationAttemptsPanel } from "@/features/billing-ledger/components/validation-attempts-panel"
import { validationAttemptsQueryOptions } from "@/features/billing-ledger/queries/transaction-queries"
import {
  formatBillingTimestamp,
  quarantineReasonExplanation,
  quarantineReasonLabel,
  quarantineStatusLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"
import { QuarantineRecoveryActionsPanel } from "@/features/billing-operations/components/quarantine-recovery-actions"
import {
  closeQuarantineSupersededMutationOptions,
  retryQuarantinedInputMutationOptions,
} from "@/features/billing-operations/mutations/quarantine-mutations"
import { quarantineRecordQueryOptions } from "@/features/billing-operations/queries/quarantine-queries"
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query"
import { ScopeMismatchRecovery } from "@/features/organizations/components/scope-mismatch-recovery"
import { WorkspacePage, WorkflowPanel } from "@/features/organizations/components/workspace-page"
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope"
import { useOrganizationAccess } from "@/hooks/use-organization-access"
import { storeConnectionsHref } from "@/lib/routing/workspace-hrefs"

interface QuarantineDetailPageProps {
  environmentId: string
  organizationId: string
  projectId: string
  recordId: string
}

export function QuarantineDetailPage({
  environmentId,
  organizationId,
  projectId,
  recordId,
}: QuarantineDetailPageProps) {
  const queryClient = useQueryClient()
  const access = useOrganizationAccess(organizationId)
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(organizationId, projectId)
  const record = useQuery({
    ...quarantineRecordQueryOptions(projectId, recordId),
    enabled: scopeReady,
  })
  const environments = useQuery({ ...environmentsQueryOptions(projectId), enabled: scopeReady })
  const attempts = useQuery({
    ...validationAttemptsQueryOptions(projectId, environmentId),
    enabled: scopeReady,
  })
  const retry = useMutation(
    retryQuarantinedInputMutationOptions(projectId, environmentId, recordId, queryClient),
  )
  const closeSuperseded = useMutation(
    closeQuarantineSupersededMutationOptions(projectId, environmentId, recordId, queryClient),
  )

  const data = record.data
  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ?? environmentId
  const relatedAttempts = (attempts.data ?? []).filter(
    (attempt) => data?.rawInputId && attempt.rawInputId === data.rawInputId,
  )

  const error = project.error ?? record.error ?? environments.error ?? attempts.error
  const state = resolveHostedQueryState({
    emptyDescription: "Return to quarantine and choose an existing record.",
    emptyTitle: "Quarantine record unavailable",
    error,
    isEmpty: record.isSuccess && !data,
    isPending:
      project.isPending ||
      (scopeReady && (record.isPending || environments.isPending || attempts.isPending)),
    loadingDescription: "Loading the quarantine record and its attempt history.",
    onRetry: () => {
      void record.refetch()
    },
    permissionDescription:
      "Organization owner or admin permission is required to read quarantine records.",
    scope: { environmentId, organizationId, projectId },
  })

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Quarantine record unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    )
  }

  const projectBase = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}`
  const billingBase = `${projectBase}/billing/${encodeURIComponent(environmentId)}`

  return (
    <WorkspacePage
      actions={
        <a
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href={`${billingBase}/quarantine`}
        >
          <ArrowLeftIcon aria-hidden /> All quarantine records
        </a>
      }
      description="Why this input could not proceed, everything already attempted, and the recovery actions that exist."
      eyebrow="Mosaic Billing · Quarantine record"
      title={quarantineReasonLabel(data?.reasonCode)}
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
                label={quarantineStatusLabel(data.status)}
                tone={data.status === "open" ? "attention" : "neutral"}
              />
              <StatusPill
                label={data.severity ?? "warning"}
                tone={data.severity === "security" ? "negative" : "neutral"}
              />
            </div>

            <WorkflowPanel
              description={quarantineReasonExplanation(data.reasonCode)}
              title="Why this input is held"
            >
              <dl>
                <DefinitionRow label="Reason code" value={data.reasonCode ?? "—"} />
                <DefinitionRow label="Diagnostic code" value={data.diagnosticCode ?? "—"} />
                <DefinitionRow label="Raw Billing Input" value={data.rawInputId ?? "—"} />
                <DefinitionRow label="Application" value={data.applicationId ?? "—"} />
                <DefinitionRow
                  label="Affected scopes"
                  value={(data.scopes ?? []).join(", ") || "—"}
                />
                <DefinitionRow label="Attempts" value={String(data.attemptCount ?? 0)} />
                <DefinitionRow
                  label="First seen"
                  value={formatBillingTimestamp(data.firstSeenAt)}
                />
                <DefinitionRow
                  label="Last attempt"
                  value={formatBillingTimestamp(data.lastAttemptAt)}
                />
                <DefinitionRow label="Closed" value={formatBillingTimestamp(data.closedAt)} />
                <DefinitionRow
                  label="Closing attempt"
                  value={
                    data.closingAttemptId ??
                    "None — this record has never been closed by a successful attempt"
                  }
                />
                <DefinitionRow label="Superseded by" value={data.supersededByRecordId ?? "—"} />
              </dl>
              {data.status === "closed_after_success" ? (
                <p className="text-muted-foreground mt-4 text-sm leading-6">
                  This record closed because a later Validation Attempt succeeded against the store.
                  That attempt is recorded above as the justification; no operator declared the
                  input valid.
                </p>
              ) : null}
            </WorkflowPanel>

            <QuarantineRecoveryActionsPanel
              canManage={access.canManage}
              {...(closeSuperseded.error ? { closeError: closeSuperseded.error.message } : {})}
              isClosing={closeSuperseded.isPending}
              isRetrying={retry.isPending}
              membersHref={`/organizations/${encodeURIComponent(organizationId)}/members`}
              onCloseSuperseded={(supersededByRecordId) =>
                closeSuperseded.mutate({ supersededByRecordId })
              }
              onRetryValidation={() => retry.mutate()}
              productMappingHref={`${projectBase}/catalog/products`}
              record={data}
              {...(retry.error ? { retryError: retry.error.message } : {})}
              storeConnectionsHref={storeConnectionsHref({ organizationId, projectId }) ?? "#"}
            />

            {retry.isSuccess ? (
              <p className="text-muted-foreground text-sm" role="status">
                The input was re-queued for validation. A new Validation Attempt appears below once
                the worker has asked the store; the record closes only if that attempt succeeds.
              </p>
            ) : null}

            <ValidationAttemptsPanel attempts={relatedAttempts} />
          </>
        ) : null}
      </HostedResourceBoundary>
    </WorkspacePage>
  )
}
