import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";

import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { MigrationJourneyCockpit } from "@/features/billing-migrations/components/migration-journey-cockpit";
import { MigrationLifecycleOperations } from "@/features/billing-migrations/components/migration-lifecycle-operations";
import type {
  DetailSearchChange,
  DetailTab,
} from "@/features/billing-migrations/components/migration-program-detail-support";
import {
  MigrationCompareTab,
  MigrationDetailTabNav,
  MigrationEvidenceTab,
  MigrationImportsTab,
  MigrationMappingsTab,
  MigrationOverviewTab,
  MigrationReadinessTab,
} from "@/features/billing-migrations/components/migration-program-detail-tabs";
import { useMigrationProgramCommands } from "@/features/billing-migrations/hooks/use-migration-program-commands";
import {
  migrationBatchesQueryOptions,
  migrationBatchQueryOptions,
  migrationDivergencesQueryOptions,
  migrationLifecycleQueryOptions,
  migrationManifestsQueryOptions,
  migrationMappingsQueryOptions,
  migrationProgramQueryOptions,
  migrationReadinessQueryOptions,
  migrationRunQueryOptions,
} from "@/features/billing-migrations/queries/migration-queries";
import {
  laterLifecycleNotice,
  migrationCommandJourney,
} from "@/features/billing-migrations/types/migration-operations";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import { WorkspacePage } from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import { ApiError } from "@/lib/api/errors";

interface Props {
  batchId?: string;
  classification: string;
  onSearchChange: (next: DetailSearchChange) => void;
  organizationId: string;
  programId: string;
  projectId: string;
  runJobId?: string;
  tab: DetailTab;
}

export function MigrationProgramDetailPage({
  batchId = "",
  classification,
  onSearchChange,
  organizationId,
  programId,
  projectId,
  runJobId = "",
  tab,
}: Props) {
  const fieldIds = useId();
  const queryClient = useQueryClient();
  const access = useOrganizationAccess(organizationId);
  const { project, scopeMismatch, scopeReady } = useValidatedProjectScope(
    organizationId,
    projectId
  );
  const [importCount, setImportCount] = useState(1000);
  const [cursorBefore, setCursorBefore] = useState("");

  const [
    program,
    manifests,
    mappings,
    batches,
    divergences,
    readiness,
    batch,
    run,
    lifecycle,
  ] = useQueries({
    queries: [
      {
        ...migrationProgramQueryOptions(projectId, programId),
        enabled: scopeReady,
      },
      {
        ...migrationManifestsQueryOptions(projectId, programId),
        enabled: scopeReady,
      },
      {
        ...migrationMappingsQueryOptions(projectId, programId),
        enabled: scopeReady,
      },
      {
        ...migrationBatchesQueryOptions(projectId, programId),
        enabled: scopeReady,
      },
      {
        ...migrationDivergencesQueryOptions(
          projectId,
          programId,
          classification
        ),
        enabled: scopeReady,
      },
      {
        ...migrationReadinessQueryOptions(projectId, programId),
        enabled: scopeReady,
      },
      {
        ...migrationBatchQueryOptions(projectId, programId, batchId),
        enabled: scopeReady && batchId.length > 0,
      },
      {
        ...migrationRunQueryOptions(projectId, programId, runJobId),
        enabled: scopeReady && runJobId.length > 0,
      },
      {
        ...migrationLifecycleQueryOptions(projectId, programId),
        enabled: scopeReady,
      },
    ],
  });
  const {
    anyCommandPending,
    assess,
    command,
    createBatch,
    createMapping,
    dryRun,
    freezeMapping,
    shadowRun,
  } = useMigrationProgramCommands(projectId, programId, queryClient);

  const detail = program.data;
  const current = detail?.program;
  const latestManifest = manifests.data?.at(0);
  const latestMapping = mappings.data?.at(0);
  const divergenceCounts = useMemo(
    () =>
      (divergences.data ?? []).reduce(
        (counts, item) => {
          counts[item.classification] += 1;
          return counts;
        },
        { blocking: 0, critical: 0, informational: 0, warning: 0 }
      ),
    [divergences.data]
  );
  const journey =
    current && detail ? migrationCommandJourney(current.state, detail) : null;
  const commonError =
    project.error ??
    access.error ??
    program.error ??
    manifests.error ??
    mappings.error ??
    batches.error ??
    divergences.error ??
    lifecycle.error;
  const readinessMissing =
    readiness.error instanceof ApiError && readiness.error.status === 404;
  const state = resolveHostedQueryState({
    error: commonError,
    isEmpty: false,
    isPending:
      project.isPending ||
      access.isPending ||
      (scopeReady &&
        (program.isPending ||
          manifests.isPending ||
          mappings.isPending ||
          batches.isPending ||
          divergences.isPending ||
          lifecycle.isPending)),
    loadingDescription:
      "Loading migration scope and operational evidence in parallel.",
    onRetry: () => {
      program.refetch();
      manifests.refetch();
      mappings.refetch();
      batches.refetch();
      divergences.refetch();
      lifecycle.refetch();
    },
    permissionDescription:
      "Project membership is required to view this Migration Program.",
    scope: { organizationId, projectId },
  });

  const programBase = `/orgs/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/billing/migrations/${encodeURIComponent(programId)}`;
  const scopeRows = useMemo(
    () => current?.scope.applications ?? [],
    [current?.scope.applications]
  );

  if (scopeMismatch) {
    return (
      <WorkspacePage
        description="The routed Organization does not own this Project."
        title="Migration Program unavailable"
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
      description="Move this Program through explicit mapping, bounded import, isolated comparison, and evidence-derived readiness."
      eyebrow="Mosaic Billing · Migration Programs"
      title={
        current
          ? `RevenueCat migration · ${current.state.replaceAll("_", " ")}`
          : "Migration Program"
      }
    >
      {current ? (
        <MigrationJourneyCockpit baseHref={programBase} program={current} />
      ) : null}
      <MigrationDetailTabNav activeTab={tab} programBase={programBase} />
      {command.error ? (
        <p className="rounded border p-3 text-destructive text-sm" role="alert">
          {command.error}
        </p>
      ) : null}
      <HostedResourceBoundary state={state}>
        {current ? (
          <p className="rounded border border-dashed p-3 text-muted-foreground text-sm">
            {laterLifecycleNotice(current)} No cutover, rollback, or repair
            command is implied by this page.
          </p>
        ) : null}

        {tab === "overview" && current ? (
          <MigrationOverviewTab
            current={current}
            detail={detail}
            organizationRole={access.role}
            scopeRows={scopeRows}
          />
        ) : null}

        {tab === "evidence" ? (
          <MigrationEvidenceTab manifests={manifests.data} />
        ) : null}

        {tab === "mappings" ? (
          <MigrationMappingsTab
            current={current}
            isPending={anyCommandPending}
            journey={journey}
            mappings={mappings.data}
            onCreateMapping={createMapping.mutateAsync}
            onFreezeMapping={freezeMapping.mutateAsync}
            runCommand={command.run}
          />
        ) : null}

        {tab === "imports" ? (
          <MigrationImportsTab
            batch={batch.data}
            batches={batches.data}
            current={current}
            cursorBefore={cursorBefore}
            detail={detail}
            fieldIds={fieldIds}
            importCount={importCount}
            isPending={anyCommandPending}
            latestManifest={latestManifest}
            latestMapping={latestMapping}
            onCreateBatch={createBatch.mutateAsync}
            onCursorBeforeChange={setCursorBefore}
            onImportCountChange={setImportCount}
            onSearchChange={onSearchChange}
            programBase={programBase}
            runCommand={command.run}
          />
        ) : null}

        {tab === "compare" ? (
          <MigrationCompareTab
            classification={classification}
            current={current}
            detail={detail}
            divergences={divergences.data}
            isPending={anyCommandPending}
            journey={journey}
            latestManifest={latestManifest}
            latestMapping={latestMapping}
            onQueueDryRun={dryRun.mutateAsync}
            onQueueShadowRun={shadowRun.mutateAsync}
            onSearchChange={onSearchChange}
            run={run.data}
            runCommand={command.run}
          />
        ) : null}

        {tab === "readiness" ? (
          <MigrationReadinessTab
            current={current}
            detail={detail}
            divergenceCounts={divergenceCounts}
            isPending={anyCommandPending}
            journey={journey}
            latestManifest={latestManifest}
            latestMapping={latestMapping}
            onAssess={assess.mutateAsync}
            readiness={readiness.data}
            readinessError={readiness.error}
            readinessMissing={readinessMissing}
            runCommand={command.run}
          />
        ) : null}
        {tab === "lifecycle" && detail ? (
          <MigrationLifecycleOperations
            data={lifecycle.data}
            detail={detail}
            organizationRole={access.role}
            programId={programId}
            projectId={projectId}
            queryClient={queryClient}
          />
        ) : null}
      </HostedResourceBoundary>
    </WorkspacePage>
  );
}
