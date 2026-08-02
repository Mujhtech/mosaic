import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { buttonVariants } from "@/components/ui/button-variants";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import {
  BillingBoundaryNote,
  DefinitionRow,
  DualTimestamps,
  EnvironmentBadges,
  ProviderBadge,
  StatusPill,
} from "@/features/billing-ledger/components/billing-chrome";
import { ProductResolutionPanel } from "@/features/billing-ledger/components/product-resolution-panel";
import { RawInputPanel } from "@/features/billing-ledger/components/raw-input-panel";
import { ReplayPanel } from "@/features/billing-ledger/components/replay-panel";
import { ValidationAttemptsPanel } from "@/features/billing-ledger/components/validation-attempts-panel";
import { createReplayJobMutationOptions } from "@/features/billing-ledger/mutations/replay-mutations";
import { replayJobsQueryOptions } from "@/features/billing-ledger/queries/replay-queries";
import {
  billingLedgerQueryOptions,
  transactionFactQueryOptions,
  transactionFactsQueryOptions,
  validationAttemptsQueryOptions,
} from "@/features/billing-ledger/queries/transaction-queries";
import {
  factKindLabel,
  transactionTypeLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import { defaultTransactionFilters } from "@/features/billing-ledger/types/transaction-filters";
import { productsQueryOptions } from "@/features/catalog/queries/catalog-query";
import { environmentsQueryOptions } from "@/features/environments/queries/environments-query";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { applicationsQueryOptions } from "@/features/projects/queries/projects-query";
import type { TransactionFact } from "@/generated/api";
import { useOrganizationAccess } from "@/hooks/use-organization-access";

interface TransactionFactDetailPageProps {
  environmentId: string;
  factId: string;
  organizationId: string;
  projectId: string;
}

export function TransactionFactDetailPage({
  environmentId,
  factId,
  organizationId,
  projectId,
}: TransactionFactDetailPageProps) {
  const queryClient = useQueryClient();
  const access = useOrganizationAccess(organizationId);
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const fact = useQuery({
    ...transactionFactQueryOptions(projectId, environmentId, factId),
    enabled: scopeReady,
  });
  const environments = useQuery({
    ...environmentsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const applications = useQuery({
    ...applicationsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const products = useQuery({
    ...productsQueryOptions(projectId),
    enabled: scopeReady,
  });
  const rawInputId = fact.data?.sourceRawInputId ?? "";
  const attempts = useQuery({
    ...validationAttemptsQueryOptions(projectId, environmentId, rawInputId),
    enabled: scopeReady && rawInputId.length > 0,
  });
  const ledger = useQuery({
    ...billingLedgerQueryOptions(projectId, environmentId),
    enabled: scopeReady,
  });
  // Replay runs on a worker. Its job rows are what turn "Re-run validation"
  // from a button that does nothing visible into an operation with feedback.
  const replayJobs = useQuery({
    ...replayJobsQueryOptions(projectId, environmentId),
    enabled: scopeReady,
  });
  // Sibling facts share the source input; they are what a replay comparison
  // reads to show which Mosaic Product each attempt resolved to.
  const siblingFacts = useQuery({
    ...transactionFactsQueryOptions(projectId, environmentId, {
      ...defaultTransactionFilters(),
      limit: 100,
    }),
    enabled: scopeReady,
  });
  const replay = useMutation(
    createReplayJobMutationOptions(projectId, environmentId, queryClient)
  );

  const record = fact.data;
  const environmentName =
    environments.data?.items.find((item) => item.id === environmentId)?.name ??
    environmentId;
  const applicationName =
    applications.data?.items.find((item) => item.id === record?.applicationId)
      ?.name ??
    record?.applicationId ??
    "—";
  // Scoped by the API to this input, so the list is the input's complete
  // attempt history rather than whatever fell inside an Environment-wide page.
  const relatedAttempts = attempts.data ?? [];
  // Replay jobs for this input, plus window replays that could have touched it.
  const relatedReplayJobs = (replayJobs.data ?? []).filter(
    (job) => !job.rawInputId || job.rawInputId === rawInputId
  );
  const factsByAttemptId = new Map<string, TransactionFact>(
    (siblingFacts.data?.items ?? []).flatMap((item) =>
      item.validationAttemptId
        ? [[item.validationAttemptId, item] as const]
        : []
    )
  );

  const error =
    project.error ??
    fact.error ??
    environments.error ??
    applications.error ??
    attempts.error ??
    ledger.error;
  const state = resolveHostedQueryState({
    emptyDescription:
      "This Transaction Fact is not in the recent ledger window for this Mosaic Environment. Open the ledger and narrow the date range to find it.",
    emptyTitle: "Transaction Fact unavailable",
    error,
    isEmpty: fact.isSuccess && !record,
    isPending:
      project.isPending ||
      (scopeReady &&
        (fact.isPending ||
          environments.isPending ||
          applications.isPending ||
          ledger.isPending ||
          (rawInputId.length > 0 && attempts.isPending))),
    loadingDescription:
      "Loading the Transaction Fact, its attempts, and its ledger trail.",
    onRetry: () => {
      fact.refetch();
      attempts.refetch();
    },
    permissionDescription:
      "Organization owner or admin permission is required to read the Mosaic Billing ledger.",
    scope: { environmentId, organizationId, projectId },
  });

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Transaction Fact unavailable in this Organization"
      >
        <ScopeMismatchRecovery
          mismatch={scopeMismatch}
          organizationId={organizationId}
          projectId={projectId}
        />
      </WorkspacePage>
    );
  }

  const projectBase = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}`;
  const billingBase = `${projectBase}/billing/${encodeURIComponent(environmentId)}`;

  return (
    <WorkspacePage
      actions={
        <a
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href={`${billingBase}/transactions`}
        >
          <ArrowLeftIcon aria-hidden /> Transaction ledger
        </a>
      }
      description="One store-confirmed transaction, the attempts that produced it, and the mapping version that resolved it."
      eyebrow="Mosaic Billing · Transaction Fact"
      title={record?.providerTransactionId ?? "Transaction Fact"}
    >
      <BillingBoundaryNote />

      <HostedResourceBoundary state={state}>
        {record ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ProviderBadge provider={record.provider} />
              <EnvironmentBadges
                mosaicEnvironmentName={environmentName}
                storeEnvironment={record.storeEnvironment}
              />
              <StatusPill
                label={factKindLabel(record.factKind)}
                tone="neutral"
              />
              {record.isTestTransaction ? (
                <StatusPill label="Store test transaction" tone="attention" />
              ) : null}
            </div>

            <WorkflowPanel
              description="Normalized, provider-independent, and carrying no price, currency, or identity of any person."
              title="Recorded fact"
            >
              <div className="mb-4">
                <DualTimestamps
                  occurredAt={record.occurredAt}
                  recordedAt={record.recordedAt}
                />
              </div>
              <dl>
                <DefinitionRow label="Application" value={applicationName} />
                <DefinitionRow
                  label="Store transaction ID"
                  value={record.providerTransactionId ?? "—"}
                />
                <DefinitionRow
                  label="Original transaction ID"
                  value={record.providerOriginalTransactionId ?? "—"}
                />
                <DefinitionRow
                  label="Transaction type"
                  value={transactionTypeLabel(record.transactionType)}
                />
                <DefinitionRow
                  label="Fact kind"
                  value={factKindLabel(record.factKind)}
                />
                <DefinitionRow
                  label="Store-stated period"
                  value={
                    record.periodStartAt || record.periodEndAt
                      ? `${record.periodStartAt ?? "—"} → ${record.periodEndAt ?? "—"}`
                      : "Not stated"
                  }
                />
                <DefinitionRow
                  label="Renewal expected by the store"
                  value={(() => {
                    if (record.renewalExpected === undefined) {
                      return "Not stated";
                    }
                    if (record.renewalExpected) {
                      return "Yes";
                    }
                    return "No";
                  })()}
                />
                <DefinitionRow
                  label="Revoked"
                  value={record.revokedAt ?? "—"}
                />
                <DefinitionRow
                  label="Refunded"
                  value={record.refundedAt ?? "—"}
                />
              </dl>
              <p className="mt-4 text-muted-foreground text-xs leading-5">
                The period above is what the store stated about this
                transaction. Mosaic does not interpret it, extend it, or use it
                to decide what anyone may do in your app.
              </p>
            </WorkflowPanel>

            <ProductResolutionPanel
              fact={record}
              productHref={(productId) =>
                `${projectBase}/catalog/products/${encodeURIComponent(productId)}`
              }
              products={products.data?.items ?? []}
              quarantineHref={`${billingBase}/quarantine`}
            />

            <RawInputPanel entries={ledger.data ?? []} fact={record} />

            <ValidationAttemptsPanel attempts={relatedAttempts} />

            <ReplayPanel
              attempts={relatedAttempts}
              canManage={access.canManage}
              factsByAttemptId={factsByAttemptId}
              isReplaying={replay.isPending}
              jobs={relatedReplayJobs}
              justQueued={replay.isSuccess}
              {...(record.mosaicProductId
                ? {
                    mappingHistoryHref: `${projectBase}/catalog/products/${encodeURIComponent(record.mosaicProductId)}`,
                  }
                : {})}
              onReplay={() =>
                replay.mutate({
                  kind: "revalidation",
                  ...(record.sourceRawInputId
                    ? { rawInputId: record.sourceRawInputId }
                    : {}),
                })
              }
              quarantineHref={`${billingBase}/quarantine`}
              {...(replay.error ? { replayError: replay.error.message } : {})}
              {...(record.validatorVersion === undefined
                ? {}
                : { validatorVersion: record.validatorVersion })}
            />
          </>
        ) : null}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
