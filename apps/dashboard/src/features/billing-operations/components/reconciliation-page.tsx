import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import {
  BillingBoundaryNote,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome";
import {
  formatBillingTimestamp,
  providerLabel,
  runStatusLabel,
  runTriggerLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import { CreateReconciliationRunSheet } from "@/features/billing-operations/components/create-reconciliation-run-sheet";
import { createReconciliationRunMutationOptions } from "@/features/billing-operations/mutations/reconciliation-mutations";
import {
  reconciliationRunIsTerminal,
  reconciliationRunsQueryOptions,
} from "@/features/billing-operations/queries/reconciliation-queries";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { storeCredentialsQueryOptions } from "@/features/store-connections/queries/store-connection-queries";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import { storeConnectionsHref } from "@/lib/routing/workspace-hrefs";

interface ReconciliationPageProps {
  cursor?: string;
  environmentId: string;
  onCursorChange: (cursor: string | undefined) => void;
  organizationId: string;
  projectId: string;
}

export function ReconciliationPage({
  cursor,
  environmentId,
  onCursorChange,
  organizationId,
  projectId,
}: ReconciliationPageProps) {
  const queryClient = useQueryClient();
  const access = useOrganizationAccess(organizationId);
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const credentials = useQuery({
    ...storeCredentialsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const runs = useQuery({
    ...reconciliationRunsQueryOptions(projectId, environmentId, cursor ?? ""),
    enabled: scopeReady,
  });
  const create = useMutation(
    createReconciliationRunMutationOptions(
      projectId,
      environmentId,
      queryClient
    )
  );

  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ??
    environmentId;
  const items = runs.data?.items ?? [];
  const nextCursor = runs.data?.nextCursor;
  const environmentCredentials = (credentials.data ?? []).filter(
    (credential) => credential.environmentId === environmentId
  );
  function credentialName(credentialId: string | undefined) {
    if (!credentialId) {
      return "—";
    }
    return (
      environmentCredentials.find((item) => item.id === credentialId)?.name ??
      credentialId
    );
  }

  const error =
    project.error ?? environments.error ?? credentials.error ?? runs.error;
  const state = resolveHostedQueryState({
    error,
    isEmpty: false,
    isPending:
      project.isPending ||
      (scopeReady &&
        (environments.isPending || credentials.isPending || runs.isPending)),
    loadingDescription: `Loading reconciliation runs for the ${environmentName} Mosaic Environment.`,
    onRetry: () => {
      runs.refetch();
    },
    permissionDescription:
      "Organization owner or admin permission is required to read reconciliation runs.",
    scope: { environmentId, organizationId, projectId },
  });

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Reconciliation unavailable in this Organization"
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
        access.canManage ? (
          <CreateReconciliationRunSheet
            credentials={environmentCredentials}
            environmentName={environmentName}
            onCreate={async (request) => {
              await create.mutateAsync(request);
            }}
            storeConnectionsHref={
              storeConnectionsHref({ organizationId, projectId }) ?? "#"
            }
          />
        ) : null
      }
      description="Reconciliation re-reads store history to find inputs Mosaic never received. It validates store-confirmed facts and does not calculate anyone's access to your app."
      eyebrow="Mosaic Billing · Reconciliation"
      title="Reconciliation"
    >
      <BillingBoundaryNote />

      {create.error ? (
        <p className="text-destructive text-sm" role="alert">
          {create.error.message}
        </p>
      ) : null}

      <HostedResourceBoundary state={state}>
        {items.length === 0 ? (
          <>
            <EmptyState
              action={
                cursor ? (
                  <Button
                    onClick={() => onCursorChange(undefined)}
                    type="button"
                    variant="outline"
                  >
                    Back to the most recent runs
                  </Button>
                ) : (
                  <a
                    className={buttonVariants({ variant: "outline" })}
                    href={`${base}/health`}
                  >
                    Check billing health first
                  </a>
                )
              }
              description={
                cursor
                  ? "This page of the reconciliation history is empty."
                  : "No reconciliation pass has run in this Mosaic Environment. Scheduled passes appear here alongside any you start with Start reconciliation above."
              }
              title="No reconciliation runs yet"
            />
            <ReconciliationPaging
              cursor={cursor}
              nextCursor={nextCursor}
              onCursorChange={onCursorChange}
            />
          </>
        ) : (
          <WorkflowPanel
            description="Runs are restart-safe and idempotent: a re-run over an overlapping window records nothing twice, so recovery from a partial run is a new run rather than an edit of the old one."
            title={
              nextCursor || cursor
                ? `${items.length} reconciliation run(s) on this page`
                : `${items.length} reconciliation run(s)`
            }
          >
            <Table>
              <TableCaption>
                Reconciliation history for the {environmentName} Mosaic
                Environment, newest first.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Window</TableHead>
                  <TableHead scope="col">Store</TableHead>
                  <TableHead scope="col">Store Server Credential</TableHead>
                  <TableHead scope="col">Trigger</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Examined</TableHead>
                  <TableHead scope="col">Discovered</TableHead>
                  <TableHead scope="col">Duplicates</TableHead>
                  <TableHead scope="col">Conflicts</TableHead>
                  <TableHead scope="col">Failures</TableHead>
                  <TableHead scope="col">Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <a
                        className="font-medium text-primary"
                        href={`${base}/reconciliation/${encodeURIComponent(run.id ?? "")}`}
                      >
                        {formatBillingTimestamp(run.windowStart)}
                      </a>
                      <span className="block text-muted-foreground text-xs">
                        → {formatBillingTimestamp(run.windowEnd)}
                      </span>
                    </TableCell>
                    <TableCell>{providerLabel(run.provider)}</TableCell>
                    <TableCell>{credentialName(run.credentialId)}</TableCell>
                    <TableCell>{runTriggerLabel(run.trigger)}</TableCell>
                    <TableCell>
                      <StatusPill
                        label={runStatusLabel(run.status)}
                        tone={
                          run.status === "completed"
                            ? "positive"
                            : run.status === "failed"
                              ? "negative"
                              : run.status === "partial"
                                ? "attention"
                                : "neutral"
                        }
                      />
                    </TableCell>
                    <TableCell>{run.examinedCount ?? 0}</TableCell>
                    <TableCell>{run.discoveredCount ?? 0}</TableCell>
                    <TableCell>{run.duplicateCount ?? 0}</TableCell>
                    <TableCell>
                      {(run.conflictCount ?? 0) > 0 ? (
                        <span className="font-medium text-destructive">
                          {run.conflictCount}
                        </span>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell>{run.failureCount ?? 0}</TableCell>
                    <TableCell title={run.completedAt}>
                      {reconciliationRunIsTerminal(run)
                        ? formatBillingTimestamp(run.completedAt)
                        : "In progress"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ReconciliationPaging
              cursor={cursor}
              nextCursor={nextCursor}
              onCursorChange={onCursorChange}
            />
          </WorkflowPanel>
        )}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}

/** Forward paging, so a page of runs is never presented as the whole history. */
function ReconciliationPaging({
  cursor,
  nextCursor,
  onCursorChange,
}: {
  cursor: string | undefined;
  nextCursor: string | undefined;
  onCursorChange: (cursor: string | undefined) => void;
}) {
  if (!(cursor || nextCursor)) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {cursor ? (
        <Button
          onClick={() => onCursorChange(undefined)}
          size="sm"
          type="button"
          variant="outline"
        >
          Most recent runs
        </Button>
      ) : null}
      {nextCursor ? (
        <Button
          onClick={() => onCursorChange(nextCursor)}
          size="sm"
          type="button"
          variant="outline"
        >
          Older runs
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">
          End of the reconciliation history.
        </p>
      )}
    </div>
  );
}
