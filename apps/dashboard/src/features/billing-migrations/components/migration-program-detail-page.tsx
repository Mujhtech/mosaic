import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HostedResourceBoundary } from "@/features/auth/components/hosted-resource-boundary";
import { resolveHostedQueryState } from "@/features/auth/types/hosted-query-state";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import { FreezeMappingAction } from "@/features/billing-migrations/components/freeze-mapping-action";
import { GuidedMappingForm } from "@/features/billing-migrations/components/guided-mapping-form";
import { MigrationImpactReviewAction } from "@/features/billing-migrations/components/migration-impact-review-action";
import { MigrationJourneyCockpit } from "@/features/billing-migrations/components/migration-journey-cockpit";
import { MigrationLifecycleOperations } from "@/features/billing-migrations/components/migration-lifecycle-operations";
import { useMigrationCommand } from "@/features/billing-migrations/hooks/use-migration-command";
import {
  assessMigrationReadinessMutationOptions,
  createMigrationBatchMutationOptions,
  createMigrationCommandKey,
  createMigrationMappingMutationOptions,
  freezeMigrationMappingMutationOptions,
  queueMigrationRunMutationOptions,
} from "@/features/billing-migrations/mutations/migration-mutations";
import {
  migrationBatchesQueryOptions,
  migrationBatchQueryOptions,
  migrationDivergencesQueryOptions,
  migrationKeys,
  migrationLifecycleQueryOptions,
  migrationManifestsQueryOptions,
  migrationMappingsQueryOptions,
  migrationProgramQueryOptions,
  migrationReadinessQueryOptions,
  migrationRunQueryOptions,
} from "@/features/billing-migrations/queries/migration-queries";
import {
  canRunMigrationCommand,
  dryRunAuthorityNotice,
  laterLifecycleNotice,
  migrationCommandJourney,
} from "@/features/billing-migrations/types/migration-operations";
import { ScopeMismatchRecovery } from "@/features/orgs/components/scope-mismatch-recovery";
import {
  WorkflowPanel,
  WorkspacePage,
} from "@/features/orgs/components/workspace-page";
import { useValidatedProjectScope } from "@/features/projects/hooks/use-validated-project-scope";
import { useOrganizationAccess } from "@/hooks/use-organization-access";
import { ApiError } from "@/lib/api/errors";

type DetailTab =
  | "overview"
  | "evidence"
  | "mappings"
  | "imports"
  | "compare"
  | "readiness"
  | "lifecycle";
const tabs: DetailTab[] = [
  "overview",
  "evidence",
  "mappings",
  "imports",
  "compare",
  "readiness",
  "lifecycle",
];
const CLASSIFICATION_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Critical", value: "critical" },
  { label: "Blocking", value: "blocking" },
  { label: "Warning", value: "warning" },
  { label: "Informational", value: "informational" },
];

interface Props {
  batchId?: string;
  classification: string;
  onSearchChange: (next: {
    batchId?: string;
    classification?: string;
    runJobId?: string;
    tab?: DetailTab;
  }) => void;
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
  const refetchProgram = useCallback(
    () =>
      queryClient.refetchQueries({
        queryKey: migrationKeys.program(projectId, programId),
      }),
    [programId, projectId, queryClient]
  );
  const command = useMigrationCommand(refetchProgram);

  const createMapping = useMutation(
    createMigrationMappingMutationOptions(projectId, programId, queryClient)
  );
  const freezeMapping = useMutation(
    freezeMigrationMappingMutationOptions(projectId, programId, queryClient)
  );
  const createBatch = useMutation(
    createMigrationBatchMutationOptions(projectId, programId, queryClient)
  );
  const dryRun = useMutation(
    queueMigrationRunMutationOptions(
      projectId,
      programId,
      "dry_run",
      queryClient
    )
  );
  const shadowRun = useMutation(
    queueMigrationRunMutationOptions(
      projectId,
      programId,
      "shadow",
      queryClient
    )
  );
  const assess = useMutation(
    assessMigrationReadinessMutationOptions(projectId, programId, queryClient)
  );

  const detail = program.data;
  const current = detail?.program;
  const latestManifest = manifests.data?.at(0);
  const latestMapping = mappings.data?.at(0);
  const divergenceCounts = useMemo(
    () =>
      (divergences.data ?? []).reduce(
        (counts, item) => ({
          ...counts,
          [item.classification]: counts[item.classification] + 1,
        }),
        { blocking: 0, critical: 0, informational: 0, warning: 0 }
      ),
    [divergences.data]
  );
  const journey =
    current && detail ? migrationCommandJourney(current.state, detail) : null;
  const anyCommandPending =
    createMapping.isPending ||
    freezeMapping.isPending ||
    createBatch.isPending ||
    dryRun.isPending ||
    shadowRun.isPending ||
    assess.isPending;
  const importDisabledReason = canRunMigrationCommand(detail, "run-import")
    ? current?.state === "importing"
      ? latestManifest
        ? latestMapping?.status === "frozen"
          ? importCount < 0 || importCount > 1000
            ? "Record count must be between 0 and 1,000."
            : null
          : "Choose and freeze a mapping set before importing."
        : "A source manifest is required before importing."
      : "Freeze a reviewed mapping set before importing."
    : "The server has not granted the run-import command. Organization role is not command authority.";
  const dryRunDisabledReason = canRunMigrationCommand(detail, "run-import")
    ? current && journey?.canQueueDryRun
      ? latestManifest && latestMapping
        ? null
        : "A source manifest and mapping set are required for comparison."
      : "Complete a bounded import before starting the dry run."
    : "The server has not granted the run-import command. Organization role is not command authority.";
  const shadowDisabledReason = canRunMigrationCommand(detail, "run-import")
    ? current && journey?.canQueueShadow
      ? latestManifest && latestMapping
        ? null
        : "A source manifest and mapping set are required for comparison."
      : "Complete the dry run before starting shadow comparison."
    : "The server has not granted the run-import command. Organization role is not command authority.";
  const readinessDisabledReason = canRunMigrationCommand(
    detail,
    "assess-readiness"
  )
    ? current && journey?.canAssess
      ? null
      : "Complete shadow comparison before assessing readiness."
    : "The server has not granted the assess-readiness command. Organization role is explanatory only.";
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
      <nav
        aria-label="Supporting migration views"
        className="flex flex-wrap gap-2"
      >
        {tabs.map((item) => (
          <a
            aria-current={tab === item ? "page" : undefined}
            className={
              tab === item
                ? "rounded bg-primary px-3 py-1.5 text-primary-foreground text-sm"
                : "rounded bg-muted px-3 py-1.5 text-sm"
            }
            href={`${programBase}?tab=${item}`}
            key={item}
          >
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </a>
        ))}
      </nav>
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
          <WorkflowPanel
            description="Scope is explicit. There is no wildcard Environment cutover."
            title="Program overview and immutable scope"
          >
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">State</dt>
                <dd className="font-medium">
                  {current.state} · version {current.stateVersion}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="font-medium">
                  RevenueCat · {current.source.adapterVersion}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Rollback window</dt>
                <dd className="font-medium">
                  {current.rollbackWindowDays} days
                </dd>
              </div>
            </dl>
            <ul className="mt-5 divide-y">
              {scopeRows.map((item) => (
                <li
                  className="py-2 text-sm"
                  key={`${item.applicationId}-${item.platform}`}
                >
                  {item.applicationId} · {item.platform}
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded border border-dashed p-3 text-sm">
              <p className="font-medium">Server assessments</p>
              <p className="mt-1 text-muted-foreground">
                Source reads:{" "}
                {detail?.sourceCapabilityAssessment?.capabilities.join(", ") ||
                  "Not assessed"}
                . These provider permissions do not authorize operator commands.
              </p>
              <p className="mt-1 text-muted-foreground">
                Operator commands:{" "}
                {detail?.commandCapabilities.size
                  ? [...detail.commandCapabilities].join(", ")
                  : "None granted (fail closed)"}
                . Organization role {access.role ?? "unknown"} is shown only to
                explain membership context.
              </p>
            </div>
          </WorkflowPanel>
        ) : null}

        {tab === "evidence" ? (
          <WorkflowPanel
            description="Manifests describe encrypted source objects. They are migration evidence, not Transaction Facts or proof of current access."
            title="Source manifests"
          >
            {manifests.data?.length ? (
              <ul className="divide-y">
                {manifests.data.map((item) => (
                  <li
                    className="grid gap-1 py-3 text-sm sm:grid-cols-3"
                    key={item.manifestId}
                  >
                    <span className="font-medium">{item.manifestId}</span>
                    <span>
                      {item.recordCount} records ·{" "}
                      {item.currentAccessRecordCount} current access
                    </span>
                    <code
                      className="truncate text-xs"
                      title={item.manifestDigest}
                    >
                      {item.manifestDigest}
                    </code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                No immutable source manifest has been recorded.
              </p>
            )}
          </WorkflowPanel>
        ) : null}

        {tab === "mappings" ? (
          <div className="space-y-5">
            {journey?.canCreateMapping && current ? (
              <WorkflowPanel
                description="Mappings use exact identifiers or audited aliases only. Ambiguous or fuzzy identity matches are not accepted."
                title="Create mapping-set version"
              >
                <GuidedMappingForm
                  isPending={anyCommandPending}
                  onCreate={(entries) =>
                    command.run(
                      () =>
                        createMapping.mutateAsync({
                          entries,
                          expectedStateVersion: current.stateVersion,
                          version:
                            Math.max(
                              0,
                              ...(mappings.data ?? []).map(
                                (item) => item.version
                              )
                            ) + 1,
                        }),
                      "mapping"
                    )
                  }
                />
              </WorkflowPanel>
            ) : null}
            <WorkflowPanel title="Mapping sets">
              {mappings.data?.length ? (
                <ul className="divide-y">
                  {mappings.data.map((item) => (
                    <li
                      className="flex flex-wrap items-center gap-3 py-3 text-sm"
                      key={item.mappingSetId}
                    >
                      <span className="font-medium">
                        Version {item.version}
                      </span>
                      <StatusPill
                        label={item.status}
                        tone={item.status === "frozen" ? "positive" : "neutral"}
                      />
                      <span className="text-muted-foreground">
                        {item.entries.length} entries
                      </span>
                      {item.status === "draft" &&
                      journey?.canFreezeMapping &&
                      current ? (
                        <FreezeMappingAction
                          isPending={anyCommandPending}
                          mapping={item}
                          onFreeze={(mappingSetId) =>
                            command.run(
                              () =>
                                freezeMapping.mutateAsync({
                                  expectedStateVersion: current.stateVersion,
                                  mappingSetId,
                                }),
                              "freeze"
                            )
                          }
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No mapping set has been created.
                </p>
              )}
            </WorkflowPanel>
          </div>
        ) : null}

        {tab === "imports" ? (
          <div className="space-y-5">
            {current ? (
              <WorkflowPanel
                description="Queues a bounded, resumable batch of at most 1,000 records. Replays with the same idempotency key do not duplicate work."
                title="Queue import batch"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    Record count
                    <Input
                      max={1000}
                      min={0}
                      onChange={(event) =>
                        setImportCount(Number(event.target.value))
                      }
                      type="number"
                      value={importCount}
                    />
                  </label>
                  <label className="text-sm">
                    Cursor before
                    <Input
                      onChange={(event) => setCursorBefore(event.target.value)}
                      value={cursorBefore}
                    />
                  </label>
                </div>
                <div className="mt-3">
                  <MigrationImpactReviewAction
                    actionLabel="Queue bounded import"
                    binding={`import:${current.stateVersion}:${latestManifest?.manifestId ?? "none"}:${latestMapping?.mappingSetId ?? "none"}:${importCount}:${cursorBefore}`}
                    disabledReason={importDisabledReason}
                    facts={[
                      {
                        label: "Program state version",
                        value: String(current.stateVersion),
                      },
                      {
                        label: "Source manifest",
                        value: latestManifest?.manifestId ?? "Missing",
                      },
                      {
                        label: "Frozen mapping set",
                        value: latestMapping?.mappingSetId ?? "Missing",
                      },
                      {
                        label: "Records in this batch",
                        value: String(importCount),
                      },
                      {
                        label: "Cursor before",
                        value: cursorBefore || "Start of source",
                      },
                    ]}
                    isPending={anyCommandPending}
                    onConfirm={() =>
                      command.run(async () => {
                        const created = await createBatch.mutateAsync({
                          body: {
                            cursorBefore,
                            expectedStateVersion: current.stateVersion,
                            manifestId: latestManifest?.manifestId ?? "",
                            mappingSetId: latestMapping?.mappingSetId ?? "",
                            recordCount: importCount,
                          },
                          idempotencyKey: createMigrationCommandKey(),
                        });
                        onSearchChange({
                          batchId: created.batchId,
                          tab: "imports",
                        });
                      }, "import")
                    }
                    pendingLabel="Queueing import…"
                    title="Review import impact"
                  />
                </div>
              </WorkflowPanel>
            ) : null}
            <WorkflowPanel title="Import batches">
              {batches.data?.length ? (
                <ul className="divide-y">
                  {batches.data.map((item) => (
                    <li
                      className="flex items-center gap-3 py-3 text-sm"
                      key={item.batchId}
                    >
                      <a
                        className="font-medium text-primary"
                        href={`${programBase}?tab=imports&batchId=${encodeURIComponent(item.batchId)}`}
                      >
                        {item.batchId}
                      </a>
                      <StatusPill
                        label={item.status}
                        tone={
                          item.status === "failed"
                            ? "negative"
                            : item.status === "completed"
                              ? "positive"
                              : "neutral"
                        }
                      />
                      <span>
                        {item.validatedCount}/{item.recordCount} validated ·{" "}
                        {item.quarantinedCount} quarantined
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No import batch has been queued.
                </p>
              )}
              {batch.data ? (
                <p className="mt-3 rounded bg-muted p-3 text-sm">
                  Selected batch {batch.data.batchId}: {batch.data.status},{" "}
                  {batch.data.validatedCount} validated and{" "}
                  {batch.data.quarantinedCount} quarantined.
                </p>
              ) : null}
            </WorkflowPanel>
          </div>
        ) : null}

        {tab === "compare" ? (
          <div className="space-y-5">
            <WorkflowPanel
              description="These commands create durable pending jobs in an isolated migration namespace. They cannot issue tokens, move entitlement pointers, or change SDK responses."
              title="Dry run and shadow comparison"
            >
              <p className="mb-3 text-muted-foreground text-sm">
                {dryRunAuthorityNotice(
                  current?.state === "shadowing" ? "shadow" : "dry_run"
                )}
              </p>
              <div className="flex flex-wrap gap-3">
                <MigrationImpactReviewAction
                  actionLabel="Queue dry run"
                  binding={`dry:${current?.stateVersion ?? 0}:${latestManifest?.manifestDigest ?? "none"}:${latestMapping?.mappingDigest ?? "none"}`}
                  disabledReason={dryRunDisabledReason}
                  facts={[
                    {
                      label: "Program state version",
                      value: String(current?.stateVersion ?? "Missing"),
                    },
                    {
                      label: "Manifest digest",
                      value: latestManifest?.manifestDigest ?? "Missing",
                    },
                    {
                      label: "Manifest records",
                      value: String(latestManifest?.recordCount ?? 0),
                    },
                    {
                      label: "Mapping digest",
                      value: latestMapping?.mappingDigest ?? "Missing",
                    },
                    {
                      label: "Mapping entries",
                      value: String(latestMapping?.entries.length ?? 0),
                    },
                  ]}
                  isPending={anyCommandPending}
                  onConfirm={() =>
                    command.run(async () => {
                      const job = await dryRun.mutateAsync({
                        body: {
                          expectedStateVersion: current?.stateVersion ?? 0,
                          manifestDigest: latestManifest?.manifestDigest ?? "",
                          mappingDigest: latestMapping?.mappingDigest ?? "",
                        },
                        idempotencyKey: createMigrationCommandKey(),
                      });
                      onSearchChange({
                        runJobId: job.runJobId,
                        tab: "compare",
                      });
                    }, "run")
                  }
                  pendingLabel="Queueing dry run…"
                  title="Review dry-run impact"
                />
                <MigrationImpactReviewAction
                  actionLabel="Queue shadow run"
                  binding={`shadow:${current?.stateVersion ?? 0}:${latestManifest?.manifestDigest ?? "none"}:${latestMapping?.mappingDigest ?? "none"}`}
                  disabledReason={shadowDisabledReason}
                  facts={[
                    {
                      label: "Program state version",
                      value: String(current?.stateVersion ?? "Missing"),
                    },
                    {
                      label: "Manifest digest",
                      value: latestManifest?.manifestDigest ?? "Missing",
                    },
                    {
                      label: "Current-access records",
                      value: String(
                        latestManifest?.currentAccessRecordCount ?? 0
                      ),
                    },
                    {
                      label: "Mapping digest",
                      value: latestMapping?.mappingDigest ?? "Missing",
                    },
                    {
                      label: "Mapping entries",
                      value: String(latestMapping?.entries.length ?? 0),
                    },
                  ]}
                  isPending={anyCommandPending}
                  onConfirm={() =>
                    command.run(async () => {
                      const job = await shadowRun.mutateAsync({
                        body: {
                          expectedStateVersion: current?.stateVersion ?? 0,
                          manifestDigest: latestManifest?.manifestDigest ?? "",
                          mappingDigest: latestMapping?.mappingDigest ?? "",
                        },
                        idempotencyKey: createMigrationCommandKey(),
                      });
                      onSearchChange({
                        runJobId: job.runJobId,
                        tab: "compare",
                      });
                    }, "run")
                  }
                  pendingLabel="Queueing shadow comparison…"
                  title="Review shadow-run impact"
                  variant="outline"
                />
              </div>
              {run.data ? (
                <div
                  className="mt-4 rounded bg-muted p-3 text-sm"
                  role="status"
                >
                  <strong>{run.data.runKind.replaceAll("_", " ")}</strong> ·{" "}
                  {run.data.status}. {dryRunAuthorityNotice(run.data.runKind)}
                </div>
              ) : null}
            </WorkflowPanel>
            <WorkflowPanel title="Divergence queue">
              <label className="text-sm" htmlFor="divergence-class">
                Classification{" "}
              </label>
              <Select
                items={CLASSIFICATION_OPTIONS}
                onValueChange={(value) =>
                  onSearchChange({ classification: value, tab: "compare" })
                }
                value={classification}
              >
                <SelectTrigger id="divergence-class">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLASSIFICATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {divergences.data?.length ? (
                <ul className="mt-3 divide-y">
                  {divergences.data.map((item) => (
                    <li className="py-3 text-sm" key={item.divergenceId}>
                      <StatusPill
                        label={item.classification}
                        tone={
                          item.classification === "critical" ||
                          item.classification === "blocking"
                            ? "negative"
                            : "neutral"
                        }
                      />
                      <p className="mt-2">{item.reason}</p>
                      <p className="mt-1 text-muted-foreground text-xs">
                        Rule {item.classificationRuleVersion} ·{" "}
                        {new Date(item.observedAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-muted-foreground text-sm">
                  No divergence matches this filter.
                </p>
              )}
            </WorkflowPanel>
          </div>
        ) : null}

        {tab === "readiness" ? (
          <WorkflowPanel
            description="Readiness is derived from stored evidence. Final-delta, watermark freshness, and supported-version checks stay visibly pending until Mosaic can verify them."
            title="Latest readiness assessment"
          >
            {current ? (
              <MigrationImpactReviewAction
                actionLabel="Create readiness assessment"
                binding={`readiness:${current.stateVersion}:${latestManifest?.manifestDigest ?? "none"}:${latestMapping?.mappingDigest ?? "none"}:${divergenceCounts.critical}:${divergenceCounts.blocking}:${divergenceCounts.warning}:${divergenceCounts.informational}`}
                disabledReason={readinessDisabledReason}
                facts={[
                  {
                    label: "Program state version",
                    value: String(current.stateVersion),
                  },
                  {
                    label: "Manifest digest",
                    value: latestManifest?.manifestDigest ?? "Missing",
                  },
                  {
                    label: "Mapping digest",
                    value: latestMapping?.mappingDigest ?? "Missing",
                  },
                  {
                    label: "Critical / blocking divergences",
                    value: `${divergenceCounts.critical} / ${divergenceCounts.blocking}`,
                  },
                  {
                    label: "Warning / informational divergences",
                    value: `${divergenceCounts.warning} / ${divergenceCounts.informational}`,
                  },
                ]}
                isPending={anyCommandPending}
                onConfirm={() =>
                  command.run(
                    () =>
                      assess.mutateAsync({
                        expectedStateVersion: current.stateVersion,
                      }),
                    "readiness"
                  )
                }
                pendingLabel="Assessing readiness…"
                title="Review readiness impact"
              />
            ) : null}
            {readiness.data ? (
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Ready</dt>
                  <dd className="font-semibold">
                    {readiness.data.ready ? "Yes" : "No"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Current-access mapping
                  </dt>
                  <dd>{readiness.data.currentAccessMappingPercent}%</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Validated evidence</dt>
                  <dd>{readiness.data.currentAccessEvidencePercent}%</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Critical / blocking</dt>
                  <dd>
                    {readiness.data.unresolved.critical} /{" "}
                    {readiness.data.unresolved.blocking}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Final delta</dt>
                  <dd>
                    {readiness.data.finalDeltaCompleted
                      ? "Complete"
                      : "Pending"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    Fresh watermarks / aware versions
                  </dt>
                  <dd>
                    {readiness.data.watermarksFresh ? "Fresh" : "Pending"} /{" "}
                    {readiness.data.supportedVersionsAuthorityAware
                      ? "Ready"
                      : "Pending"}
                  </dd>
                </div>
              </dl>
            ) : readinessMissing ? (
              <p className="mt-4 text-muted-foreground text-sm">
                No readiness assessment exists yet.
              </p>
            ) : readiness.error ? (
              <p className="mt-4 text-destructive text-sm" role="alert">
                Mosaic could not load the latest readiness assessment. Refresh
                this view and try again.
              </p>
            ) : null}
          </WorkflowPanel>
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
