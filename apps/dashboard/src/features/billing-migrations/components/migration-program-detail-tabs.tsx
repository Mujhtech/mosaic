import { LocalDateTime } from "@/components/feedback/local-date-time";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/features/billing-ledger/components/billing-chrome";
import { FreezeMappingAction } from "@/features/billing-migrations/components/freeze-mapping-action";
import { GuidedMappingForm } from "@/features/billing-migrations/components/guided-mapping-form";
import { MigrationImpactReviewAction } from "@/features/billing-migrations/components/migration-impact-review-action";
import {
  CLASSIFICATION_OPTIONS,
  type DetailSearchChange,
  type DetailTab,
  dryRunDisabledReason,
  importDisabledReason,
  type MigrationJourney,
  readinessDisabledReason,
  shadowDisabledReason,
  tabs,
} from "@/features/billing-migrations/components/migration-program-detail-support";
import type { useMigrationCommand } from "@/features/billing-migrations/hooks/use-migration-command";
import { createMigrationCommandKey } from "@/features/billing-migrations/mutations/migration-mutations";
import type { MigrationProgramView } from "@/features/billing-migrations/types/migration-operations";
import {
  dryRunAuthorityNotice,
  MigrationCommandBindingError,
} from "@/features/billing-migrations/types/migration-operations";
import { WorkflowPanel } from "@/features/orgs/components/workspace-page";
import type {
  BillingMigrationDivergence,
  BillingMigrationImportBatch,
  BillingMigrationMappingSet,
  BillingMigrationProgram,
  BillingMigrationReadiness,
  BillingMigrationRunJob,
  BillingMigrationSourceManifest,
  BillingMigrationStateVersionRequest,
  CreateBillingMigrationImportBatchRequest,
  CreateBillingMigrationMappingSetRequest,
  QueueBillingMigrationRunRequest,
} from "@/generated/api";

type RunCommand = ReturnType<typeof useMigrationCommand>["run"];

interface DivergenceCounts {
  blocking: number;
  critical: number;
  informational: number;
  warning: number;
}

export function MigrationDetailTabNav({
  activeTab,
  programBase,
}: {
  activeTab: DetailTab;
  programBase: string;
}) {
  return (
    <nav
      aria-label="Supporting migration views"
      className="flex flex-wrap gap-2"
    >
      {tabs.map((item) => (
        <a
          aria-current={activeTab === item ? "page" : undefined}
          className={
            activeTab === item
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
  );
}

export function MigrationOverviewTab({
  current,
  detail,
  organizationRole,
  scopeRows,
}: {
  current: BillingMigrationProgram;
  detail: MigrationProgramView | undefined;
  organizationRole?: string;
  scopeRows: BillingMigrationProgram["scope"]["applications"];
}) {
  return (
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
          <dd className="font-medium">{current.rollbackWindowDays} days</dd>
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
          . Organization role {organizationRole ?? "unknown"} is shown only to
          explain membership context.
        </p>
      </div>
    </WorkflowPanel>
  );
}

export function MigrationEvidenceTab({
  manifests,
}: {
  manifests: BillingMigrationSourceManifest[] | undefined;
}) {
  return (
    <WorkflowPanel
      description="Manifests describe encrypted source objects. They are migration evidence, not Transaction Facts or proof of current access."
      title="Source manifests"
    >
      {manifests?.length ? (
        <ul className="divide-y">
          {manifests.map((item) => (
            <li
              className="grid gap-1 py-3 text-sm sm:grid-cols-3"
              key={item.manifestId}
            >
              <span className="font-medium">{item.manifestId}</span>
              <span>
                {item.recordCount} records · {item.currentAccessRecordCount}{" "}
                current access
              </span>
              <code className="truncate text-xs" title={item.manifestDigest}>
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
  );
}

export function MigrationMappingsTab({
  current,
  isPending,
  journey,
  mappings,
  onCreateMapping,
  onFreezeMapping,
  runCommand,
}: {
  current: BillingMigrationProgram | undefined;
  isPending: boolean;
  journey: MigrationJourney | null;
  mappings: BillingMigrationMappingSet[] | undefined;
  onCreateMapping: (
    body: CreateBillingMigrationMappingSetRequest
  ) => Promise<unknown>;
  onFreezeMapping: (
    variables: BillingMigrationStateVersionRequest & { mappingSetId: string }
  ) => Promise<unknown>;
  runCommand: RunCommand;
}) {
  return (
    <div className="space-y-5">
      {journey?.canCreateMapping && current ? (
        <WorkflowPanel
          description="Mappings use exact identifiers or audited aliases only. Ambiguous or fuzzy identity matches are not accepted."
          title="Create mapping-set version"
        >
          <GuidedMappingForm
            isPending={isPending}
            onCreate={(entries) =>
              runCommand(
                () =>
                  onCreateMapping({
                    entries,
                    expectedStateVersion: current.stateVersion,
                    version:
                      Math.max(
                        0,
                        ...(mappings ?? []).map((item) => item.version)
                      ) + 1,
                  }),
                "mapping"
              )
            }
          />
        </WorkflowPanel>
      ) : null}
      <WorkflowPanel title="Mapping sets">
        {mappings?.length ? (
          <ul className="divide-y">
            {mappings.map((item) => (
              <li
                className="flex flex-wrap items-center gap-3 py-3 text-sm"
                key={item.mappingSetId}
              >
                <span className="font-medium">Version {item.version}</span>
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
                    isPending={isPending}
                    mapping={item}
                    onFreeze={(mappingSetId) =>
                      runCommand(
                        () =>
                          onFreezeMapping({
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
  );
}

export function MigrationImportsTab({
  batch,
  batches,
  cursorBefore,
  current,
  detail,
  fieldIds,
  importCount,
  isPending,
  latestManifest,
  latestMapping,
  onCreateBatch,
  onCursorBeforeChange,
  onImportCountChange,
  onSearchChange,
  programBase,
  runCommand,
}: {
  batch: BillingMigrationImportBatch | undefined;
  batches: BillingMigrationImportBatch[] | undefined;
  cursorBefore: string;
  current: BillingMigrationProgram | undefined;
  detail: MigrationProgramView | undefined;
  fieldIds: string;
  importCount: number;
  isPending: boolean;
  latestManifest: BillingMigrationSourceManifest | undefined;
  latestMapping: BillingMigrationMappingSet | undefined;
  onCreateBatch: (variables: {
    body: CreateBillingMigrationImportBatchRequest;
    idempotencyKey: string;
  }) => Promise<BillingMigrationImportBatch>;
  onCursorBeforeChange: (next: string) => void;
  onImportCountChange: (next: number) => void;
  onSearchChange: (next: DetailSearchChange) => void;
  programBase: string;
  runCommand: RunCommand;
}) {
  return (
    <div className="space-y-5">
      {current ? (
        <WorkflowPanel
          description="Queues a bounded, resumable batch of at most 1,000 records. Replays with the same idempotency key do not duplicate work."
          title="Queue import batch"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm" htmlFor={`${fieldIds}-record-count`}>
              Record count
              <Input
                id={`${fieldIds}-record-count`}
                max={1000}
                min={0}
                onChange={(event) =>
                  onImportCountChange(Number(event.target.value))
                }
                type="number"
                value={importCount}
              />
            </label>
            <label className="text-sm" htmlFor={`${fieldIds}-cursor-before`}>
              Cursor before
              <Input
                id={`${fieldIds}-cursor-before`}
                onChange={(event) => onCursorBeforeChange(event.target.value)}
                value={cursorBefore}
              />
            </label>
          </div>
          <div className="mt-3">
            <MigrationImpactReviewAction
              actionLabel="Queue bounded import"
              binding={`import:${current.stateVersion}:${latestManifest?.manifestId ?? "none"}:${latestMapping?.mappingSetId ?? "none"}:${importCount}:${cursorBefore}`}
              disabledReason={importDisabledReason({
                current,
                detail,
                importCount,
                latestManifest,
                latestMapping,
              })}
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
              isPending={isPending}
              onConfirm={() =>
                runCommand(async () => {
                  const created = await onCreateBatch({
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
        {batches?.length ? (
          <ul className="divide-y">
            {batches.map((item) => (
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
                  tone={(() => {
                    if (item.status === "failed") {
                      return "negative";
                    }
                    if (item.status === "completed") {
                      return "positive";
                    }
                    return "neutral";
                  })()}
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
        {batch ? (
          <p className="mt-3 rounded bg-muted p-3 text-sm">
            Selected batch {batch.batchId}: {batch.status},{" "}
            {batch.validatedCount} validated and {batch.quarantinedCount}{" "}
            quarantined.
          </p>
        ) : null}
      </WorkflowPanel>
    </div>
  );
}

export function MigrationCompareTab({
  classification,
  current,
  detail,
  divergences,
  isPending,
  journey,
  latestManifest,
  latestMapping,
  onQueueDryRun,
  onQueueShadowRun,
  onSearchChange,
  run,
  runCommand,
}: {
  classification: string;
  current: BillingMigrationProgram | undefined;
  detail: MigrationProgramView | undefined;
  divergences: BillingMigrationDivergence[] | undefined;
  isPending: boolean;
  journey: MigrationJourney | null;
  latestManifest: BillingMigrationSourceManifest | undefined;
  latestMapping: BillingMigrationMappingSet | undefined;
  onQueueDryRun: (variables: {
    body: QueueBillingMigrationRunRequest;
    idempotencyKey: string;
  }) => Promise<BillingMigrationRunJob>;
  onQueueShadowRun: (variables: {
    body: QueueBillingMigrationRunRequest;
    idempotencyKey: string;
  }) => Promise<BillingMigrationRunJob>;
  onSearchChange: (next: DetailSearchChange) => void;
  run: BillingMigrationRunJob | undefined;
  runCommand: RunCommand;
}) {
  return (
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
            binding={`dry:${current?.stateVersion ?? "unknown"}:${latestManifest?.manifestDigest ?? "none"}:${latestMapping?.mappingDigest ?? "none"}`}
            disabledReason={dryRunDisabledReason({
              current,
              detail,
              journey,
              latestManifest,
              latestMapping,
            })}
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
            isPending={isPending}
            onConfirm={() =>
              runCommand(async () => {
                if (!(current && latestManifest && latestMapping)) {
                  throw new MigrationCommandBindingError();
                }
                const job = await onQueueDryRun({
                  body: {
                    expectedStateVersion: current.stateVersion,
                    manifestDigest: latestManifest.manifestDigest,
                    mappingDigest: latestMapping.mappingDigest,
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
            binding={`shadow:${current?.stateVersion ?? "unknown"}:${latestManifest?.manifestDigest ?? "none"}:${latestMapping?.mappingDigest ?? "none"}`}
            disabledReason={shadowDisabledReason({
              current,
              detail,
              journey,
              latestManifest,
              latestMapping,
            })}
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
                value: String(latestManifest?.currentAccessRecordCount ?? 0),
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
            isPending={isPending}
            onConfirm={() =>
              runCommand(async () => {
                if (!(current && latestManifest && latestMapping)) {
                  throw new MigrationCommandBindingError();
                }
                const job = await onQueueShadowRun({
                  body: {
                    expectedStateVersion: current.stateVersion,
                    manifestDigest: latestManifest.manifestDigest,
                    mappingDigest: latestMapping.mappingDigest,
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
        {run ? (
          <div className="mt-4 rounded bg-muted p-3 text-sm" role="status">
            <strong>{run.runKind.replaceAll("_", " ")}</strong> · {run.status}.{" "}
            {dryRunAuthorityNotice(run.runKind)}
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
        {divergences?.length ? (
          <ul className="mt-3 divide-y">
            {divergences.map((item) => (
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
                  <LocalDateTime value={item.observedAt} />
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
  );
}

export function MigrationReadinessTab({
  current,
  detail,
  divergenceCounts,
  isPending,
  journey,
  latestManifest,
  latestMapping,
  onAssess,
  readiness,
  readinessError,
  readinessMissing,
  runCommand,
}: {
  current: BillingMigrationProgram | undefined;
  detail: MigrationProgramView | undefined;
  divergenceCounts: DivergenceCounts;
  isPending: boolean;
  journey: MigrationJourney | null;
  latestManifest: BillingMigrationSourceManifest | undefined;
  latestMapping: BillingMigrationMappingSet | undefined;
  onAssess: (body: BillingMigrationStateVersionRequest) => Promise<unknown>;
  readiness: BillingMigrationReadiness | undefined;
  readinessError: unknown;
  readinessMissing: boolean;
  runCommand: RunCommand;
}) {
  return (
    <WorkflowPanel
      description="Readiness is derived from stored evidence. Final-delta, watermark freshness, and supported-version checks stay visibly pending until Mosaic can verify them."
      title="Latest readiness assessment"
    >
      {current ? (
        <MigrationImpactReviewAction
          actionLabel="Create readiness assessment"
          binding={`readiness:${current.stateVersion}:${latestManifest?.manifestDigest ?? "none"}:${latestMapping?.mappingDigest ?? "none"}:${divergenceCounts.critical}:${divergenceCounts.blocking}:${divergenceCounts.warning}:${divergenceCounts.informational}`}
          disabledReason={readinessDisabledReason({
            current,
            detail,
            journey,
          })}
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
          isPending={isPending}
          onConfirm={() =>
            runCommand(
              () =>
                onAssess({
                  expectedStateVersion: current.stateVersion,
                }),
              "readiness"
            )
          }
          pendingLabel="Assessing readiness…"
          title="Review readiness impact"
        />
      ) : null}
      {(() => {
        if (readiness) {
          return <ReadinessSummary readiness={readiness} />;
        }
        if (readinessMissing) {
          return (
            <p className="mt-4 text-muted-foreground text-sm">
              No readiness assessment exists yet.
            </p>
          );
        }
        if (readinessError) {
          return (
            <p className="mt-4 text-destructive text-sm" role="alert">
              Mosaic could not load the latest readiness assessment. Refresh
              this view and try again.
            </p>
          );
        }
        return null;
      })()}
    </WorkflowPanel>
  );
}

function ReadinessSummary({
  readiness,
}: {
  readiness: BillingMigrationReadiness;
}) {
  return (
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">Ready</dt>
        <dd className="font-semibold">{readiness.ready ? "Yes" : "No"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Current-access mapping</dt>
        <dd>{readiness.currentAccessMappingPercent}%</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Validated evidence</dt>
        <dd>{readiness.currentAccessEvidencePercent}%</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Critical / blocking</dt>
        <dd>
          {readiness.unresolved.critical} / {readiness.unresolved.blocking}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Final delta</dt>
        <dd>{readiness.finalDeltaCompleted ? "Complete" : "Pending"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          Fresh watermarks / aware versions
        </dt>
        <dd>
          {readiness.watermarksFresh ? "Fresh" : "Pending"} /{" "}
          {readiness.supportedVersionsAuthorityAware ? "Ready" : "Pending"}
        </dd>
      </div>
    </dl>
  );
}
