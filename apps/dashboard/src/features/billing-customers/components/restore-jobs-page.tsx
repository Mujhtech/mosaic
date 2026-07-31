import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "@/components/feedback/empty-state";
import { buttonVariants } from "@/components/ui/button-variants";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { restoreJobsQueryOptions } from "@/features/billing-customers/queries/restore-queries";
import { formatEntitlementInstant } from "@/features/billing-customers/types/entitlement-vocabulary";
import {
  describeSnapshotMovement,
  providerOutcomeLabel,
  RESTORE_LAYERS,
  RESTORE_READ_ONLY_NOTE,
  restoreOutcomeExplanation,
  restoreOutcomeLabel,
  restoreOutcomeTone,
} from "@/features/billing-customers/types/restore-vocabulary";
import {
  DefinitionRow,
  LedgerPaging,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome";
import {
  BILLING_OPTIONAL_NOTE,
  runStatusLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import { billingHealthQueryOptions } from "@/features/billing-operations/queries/billing-health-queries";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import type { BillingRestoreJob } from "@/generated/api";
import {
  billingCustomerHref,
  storeConnectionsHref,
} from "@/lib/routing/workspace-hrefs";

interface RestoreJobsPageProps {
  cursor?: string;
  environmentId: string;
  onCursorChange: (cursor: string | undefined) => void;
  organizationId: string;
  projectId: string;
}

/**
 * Restore status, read-only.
 *
 * A restore is started by an SDK on a device, because only the device can ask
 * the store to replay its own purchases. There is no operator "start restore"
 * button and adding one would be a lie about what Mosaic can do — the nearest
 * real action is recomputing a customer's projection, which is on customer
 * detail and is a different operation.
 *
 * The three layers are stated in fixed copy above the list, because almost
 * every confusing restore is a case where one layer succeeded and another had
 * not finished.
 */
export function RestoreJobsPage({
  cursor,
  environmentId,
  onCursorChange,
  organizationId,
  projectId,
}: RestoreJobsPageProps) {
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const health = useQuery({
    ...billingHealthQueryOptions(projectId, environmentId),
    enabled: scopeReady,
  });
  const restores = useQuery({
    ...restoreJobsQueryOptions(projectId, environmentId, {
      ...(cursor ? { cursor } : {}),
    }),
    enabled: scopeReady,
  });

  const billingEnabled = health.data?.billingEnabled !== false;
  const items = restores.data?.items ?? [];

  const error = project.error ?? restores.error;
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending: project.isPending || (scopeReady && restores.isPending),
    loadingDescription: "Loading restore jobs for this Mosaic Environment.",
    onRetry: () => {
      restores.refetch();
    },
    permissionDescription:
      "Organization owner or admin permission is required to read restore jobs.",
    scope: { environmentId, organizationId, projectId },
  });

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Restores unavailable in this Organization"
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

  return (
    <WorkspacePage
      description="Restores an SDK reported from a device, and how far Mosaic got with each one. A restore is three separate things succeeding, and this page keeps them separate."
      eyebrow="Mosaic Billing · Restores"
      title="Restores"
    >
      <p className="text-muted-foreground text-xs leading-5">
        {RESTORE_READ_ONLY_NOTE}
      </p>

      <WorkflowPanel
        description="Almost every confusing restore is a case where one of these succeeded and the next had not finished yet."
        title="What a restore actually involves"
      >
        <ol className="space-y-3">
          {RESTORE_LAYERS.map((layer) => (
            <li className="rounded border p-4" key={layer.title}>
              <p className="font-semibold text-sm">{layer.title}</p>
              <p className="mt-1 text-muted-foreground text-sm leading-6">
                {layer.body}
              </p>
            </li>
          ))}
        </ol>
      </WorkflowPanel>

      <HostedResourceBoundary state={state}>
        {billingEnabled ? (
          items.length === 0 ? (
            <>
              <EmptyState
                description="No SDK has reported a restore in this Mosaic Environment. Restores appear here once an app calls the restore API on a device."
                title="No restores recorded yet"
              />
              <LedgerPaging
                cursor={cursor}
                endLabel="End of the restore list."
                nextCursor={restores.data?.nextCursor}
                onCursorChange={onCursorChange}
              />
            </>
          ) : (
            <WorkflowPanel title={`${items.length} restore(s) on this page`}>
              <ul className="space-y-3">
                {items.map((job) => (
                  <RestoreRow
                    customerHref={
                      job.billingCustomerId
                        ? (billingCustomerHref(scope, job.billingCustomerId) ??
                          "#")
                        : undefined
                    }
                    job={job}
                    key={job.restoreId}
                  />
                ))}
              </ul>
              <LedgerPaging
                cursor={cursor}
                endLabel="End of the restore list."
                nextCursor={restores.data?.nextCursor}
                onCursorChange={onCursorChange}
              />
            </WorkflowPanel>
          )
        ) : (
          <EmptyState
            action={
              <a
                className={buttonVariants()}
                href={storeConnectionsHref(scope) ?? "#"}
              >
                Set up Mosaic Billing
              </a>
            }
            description={`Mosaic Billing is turned off for this Project, so restore submissions are rejected and none is recorded. ${BILLING_OPTIONAL_NOTE}`}
            title="Mosaic Billing is not enabled for this Project"
          />
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}

function RestoreRow({
  customerHref,
  job,
}: {
  customerHref: string | undefined;
  job: BillingRestoreJob;
}) {
  return (
    <li className="rounded border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-all font-mono text-xs">{job.restoreId}</span>
        <div className="flex flex-wrap items-center gap-2">
          {/* Two axes, never merged. The store's own result and Mosaic's are
              different questions, and a native restore that "succeeded" says
              nothing about whether anyone's access changed. */}
          <StatusPill
            label={`Store: ${providerOutcomeLabel(job.providerOutcome)}`}
            tone="neutral"
          />
          <StatusPill
            label={`Mosaic: ${restoreOutcomeLabel(job.outcome)}`}
            tone={restoreOutcomeTone(job.outcome)}
          />
          <StatusPill label={runStatusLabel(job.status)} tone="neutral" />
        </div>
      </div>

      <p className="mt-2 text-sm leading-6">
        {restoreOutcomeExplanation(job.outcome)}
      </p>
      <p className="mt-1 text-muted-foreground text-sm leading-6">
        {describeSnapshotMovement(job)}
      </p>

      <dl className="mt-3">
        <DefinitionRow
          label="Billing Customer"
          value={
            customerHref ? (
              <a className="font-mono text-primary" href={customerHref}>
                {job.billingCustomerId}
              </a>
            ) : (
              "Not resolved yet — which is exactly the identity-unresolved outcome"
            )
          }
        />
        <DefinitionRow
          label="Observations submitted"
          value={String(job.observedTransactionCount ?? 0)}
        />
        <DefinitionRow
          label="Awaiting validation"
          value={String(job.pendingValidationCount ?? 0)}
        />
        <DefinitionRow
          label="Attempts"
          value={`${job.attemptCount ?? 0} of ${job.maxAttempts ?? "—"}`}
        />
        <DefinitionRow
          label="Requested"
          value={formatEntitlementInstant(job.requestedAt)}
        />
        <DefinitionRow
          label="Completed"
          value={formatEntitlementInstant(job.completedAt)}
        />
      </dl>
    </li>
  );
}
