import type {
  BillingMigrationCompletionPrerequisites,
  BillingMigrationImportBatch,
  BillingMigrationProgram,
  BillingMigrationProgramDetail,
  BillingMigrationReadiness,
  BillingMigrationRunJob,
} from "@/generated/api";
import { ApiError } from "@/lib/api/errors";

export const migrationCommandCapabilities = [
  "view",
  "assess-readiness",
  "manage-mappings",
  "manage-source",
  "run-import",
  "resolve-cases",
  "propose-cutover",
  "approve-cutover",
  "execute-cutover",
  "execute-rollback",
  "execute-repair",
  "delete-source",
  "remove-credential",
  "manage-legal-hold",
  "complete-migration",
] as const;

export type MigrationCommandCapability =
  (typeof migrationCommandCapabilities)[number];

export interface MigrationProgramView extends BillingMigrationProgramDetail {
  /** Closed, server-derived command capabilities. Missing means fail closed. */
  commandCapabilities: ReadonlySet<MigrationCommandCapability>;
  sourceCapabilityAssessment?: {
    adapter: string;
    assessedAt: string;
    capabilities: string[];
    programId: string;
    providerApiVersion: string;
    stateVersion: number;
  };
}

export function normalizeMigrationProgramDetail(
  payload: BillingMigrationProgramDetail
) {
  const candidate = payload as BillingMigrationProgramDetail & {
    capabilityAssessment?: MigrationProgramView["sourceCapabilityAssessment"];
    commandCapabilities?: unknown;
    operatorCapabilities?: unknown;
    sourceCapabilityAssessment?: MigrationProgramView["sourceCapabilityAssessment"];
  };
  const raw = candidate.commandCapabilities ?? candidate.operatorCapabilities;
  const allowed = new Set<string>(migrationCommandCapabilities);
  const commandCapabilities = new Set<MigrationCommandCapability>();
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === "string" && allowed.has(value)) {
        commandCapabilities.add(value as MigrationCommandCapability);
      }
    }
  }
  return {
    ...payload,
    commandCapabilities,
    sourceCapabilityAssessment:
      candidate.sourceCapabilityAssessment ?? candidate.capabilityAssessment,
  } satisfies MigrationProgramView;
}

export function canRunMigrationCommand(
  detail: MigrationProgramView | undefined,
  capability: MigrationCommandCapability
) {
  return detail?.commandCapabilities.has(capability) ?? false;
}

export function migrationRequiresDistinctApprover(
  command: "cutover" | "rollback" | "legal_hold"
) {
  return (
    command === "cutover" || command === "rollback" || command === "legal_hold"
  );
}

export function migrationCompletionBlockers(
  prerequisites: BillingMigrationCompletionPrerequisites | undefined
): string[] {
  if (!prerequisites) {
    return ["Completion evidence is unavailable."];
  }
  if (prerequisites.eligible) {
    return [];
  }
  const blockers: string[] = [];
  if (!prerequisites.credentialRemoved) {
    blockers.push("migration credential is still active");
  }
  if (prerequisites.unresolvedCriticalBlocking > 0) {
    blockers.push(
      `${prerequisites.unresolvedCriticalBlocking} critical or blocking cases remain`
    );
  }
  if (!prerequisites.authorityStable) {
    blockers.push("authority is not stable");
  }
  if (!prerequisites.webhookReady) {
    blockers.push("webhook delivery is not ready");
  }
  if (new Date(prerequisites.stabilizationEndsAt) > new Date()) {
    blockers.push("stabilization window has not ended");
  }
  if (new Date(prerequisites.rollbackWindowEndsAt) > new Date()) {
    blockers.push("rollback window has not ended");
  }
  return blockers.length
    ? blockers
    : ["Server-derived completion prerequisites are not satisfied."];
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function migrationRunIsTerminal(
  run: Pick<BillingMigrationRunJob, "status"> | undefined
) {
  return run ? TERMINAL_RUN_STATUSES.has(run.status) : false;
}

const MAX_RUN_POLL_UPDATES = 30;

export function migrationRunPollingInterval(
  run: Pick<BillingMigrationRunJob, "status"> | undefined,
  updateCount = 0
) {
  return run &&
    !migrationRunIsTerminal(run) &&
    updateCount < MAX_RUN_POLL_UPDATES
    ? 4000
    : false;
}

export function migrationCommandJourney(
  state: BillingMigrationProgram["state"],
  detail: MigrationProgramView
) {
  return {
    canAssess:
      state === "shadowing" &&
      canRunMigrationCommand(detail, "assess-readiness"),
    canCreateMapping:
      state === "mapping" && canRunMigrationCommand(detail, "manage-mappings"),
    canFreezeMapping:
      state === "mapping" && canRunMigrationCommand(detail, "manage-mappings"),
    canImport:
      state === "importing" && canRunMigrationCommand(detail, "run-import"),
    canQueueDryRun:
      ["importing", "dry_run"].includes(state) &&
      canRunMigrationCommand(detail, "run-import"),
    canQueueShadow:
      ["dry_run", "shadowing"].includes(state) &&
      canRunMigrationCommand(detail, "run-import"),
  };
}

export function isStaleMigrationConflict(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}

export function dryRunAuthorityNotice(
  runKind: BillingMigrationRunJob["runKind"]
) {
  return runKind === "dry_run"
    ? "A dry run writes isolated migration evidence only. It does not change billing authority or customer access."
    : "A shadow run compares isolated views only. It does not change billing authority or customer access.";
}

export function laterLifecycleNotice(
  program: Pick<BillingMigrationProgram, "state">
) {
  return [
    "ready",
    "cutover_pending",
    "stabilizing",
    "completed",
    "rolled_back",
  ].includes(program.state)
    ? "This workspace can inspect readiness, but RevenueCat remains the billing authority until Mosaic ships, verifies, and explicitly executes the cutover workflow."
    : "RevenueCat remains the billing authority. Cutover must be shipped, verified, and explicitly executed before Mosaic can become authoritative.";
}

export type ReadinessView = BillingMigrationReadiness;
export type MigrationImportBatch = BillingMigrationImportBatch;
export type MigrationRunJob = BillingMigrationRunJob;

export function migrationErrorCopy(
  error: unknown,
  command:
    | "create"
    | "mapping"
    | "freeze"
    | "import"
    | "run"
    | "readiness"
    | "lifecycle"
) {
  if (isStaleMigrationConflict(error)) {
    return "This Migration Program changed after you loaded it. Mosaic refreshed the latest state; review the command before trying again.";
  }
  if (error instanceof ApiError && error.status === 403) {
    return "The server denied this migration command. Mosaic refreshed your command capabilities; review the latest state or ask an authorized operator for help.";
  }
  if (error instanceof ApiError && error.status === 422) {
    return "Mosaic could not use these values. Review the highlighted fields and try again.";
  }
  return {
    create:
      "Mosaic could not check this source or create the Migration Program. Verify the source details and try again.",
    freeze:
      "Mosaic could not freeze this mapping set. Refresh the Program and review the exact version again.",
    import:
      "Mosaic could not queue this import batch. Review its manifest, mapping set, and size.",
    mapping:
      "Mosaic could not create this mapping set. Review every source and target.",
    readiness:
      "Mosaic could not create a readiness assessment from the current evidence.",
    run: "Mosaic could not queue this comparison. Review the selected evidence and try again.",
    lifecycle:
      "Mosaic could not run this lifecycle command. Review its state, digests, authority consequence, and approval before trying again.",
  }[command];
}
