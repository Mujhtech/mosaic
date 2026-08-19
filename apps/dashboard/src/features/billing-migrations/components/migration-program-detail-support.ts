import type {
  MigrationProgramView,
  migrationCommandJourney,
} from "@/features/billing-migrations/types/migration-operations";
import { canRunMigrationCommand } from "@/features/billing-migrations/types/migration-operations";
import type {
  BillingMigrationMappingSet,
  BillingMigrationProgram,
  BillingMigrationSourceManifest,
} from "@/generated/api";

export type DetailTab =
  | "overview"
  | "evidence"
  | "mappings"
  | "imports"
  | "compare"
  | "readiness"
  | "lifecycle";
export const tabs: DetailTab[] = [
  "overview",
  "evidence",
  "mappings",
  "imports",
  "compare",
  "readiness",
  "lifecycle",
];
export const CLASSIFICATION_OPTIONS = [
  { label: "All", value: "all" },
  { label: "Critical", value: "critical" },
  { label: "Blocking", value: "blocking" },
  { label: "Warning", value: "warning" },
  { label: "Informational", value: "informational" },
];

export type MigrationJourney = ReturnType<typeof migrationCommandJourney>;

export interface DetailSearchChange {
  batchId?: string;
  classification?: string;
  runJobId?: string;
  tab?: DetailTab;
}

interface CommandBinding {
  current: BillingMigrationProgram | undefined;
  detail: MigrationProgramView | undefined;
  journey: MigrationJourney | null;
  latestManifest: BillingMigrationSourceManifest | undefined;
  latestMapping: BillingMigrationMappingSet | undefined;
}

const RUN_IMPORT_NOT_GRANTED =
  "The server has not granted the run-import command. Organization role is not command authority.";

export function importDisabledReason({
  current,
  detail,
  importCount,
  latestManifest,
  latestMapping,
}: Omit<CommandBinding, "journey"> & { importCount: number }) {
  if (!canRunMigrationCommand(detail, "run-import")) {
    return RUN_IMPORT_NOT_GRANTED;
  }
  if (current?.state !== "importing") {
    return "Freeze a reviewed mapping set before importing.";
  }
  if (!latestManifest) {
    return "A source manifest is required before importing.";
  }
  if (latestMapping?.status !== "frozen") {
    return "Choose and freeze a mapping set before importing.";
  }
  if (importCount < 0 || importCount > 1000) {
    return "Record count must be between 0 and 1,000.";
  }
  return null;
}

export function dryRunDisabledReason({
  current,
  detail,
  journey,
  latestManifest,
  latestMapping,
}: CommandBinding) {
  if (!canRunMigrationCommand(detail, "run-import")) {
    return RUN_IMPORT_NOT_GRANTED;
  }
  if (!(current && journey?.canQueueDryRun)) {
    return "Complete a bounded import before starting the dry run.";
  }
  if (latestManifest && latestMapping) {
    return null;
  }
  return "A source manifest and mapping set are required for comparison.";
}

export function shadowDisabledReason({
  current,
  detail,
  journey,
  latestManifest,
  latestMapping,
}: CommandBinding) {
  if (!canRunMigrationCommand(detail, "run-import")) {
    return RUN_IMPORT_NOT_GRANTED;
  }
  if (!(current && journey?.canQueueShadow)) {
    return "Complete the dry run before starting shadow comparison.";
  }
  if (latestManifest && latestMapping) {
    return null;
  }
  return "A source manifest and mapping set are required for comparison.";
}

export function readinessDisabledReason({
  current,
  detail,
  journey,
}: Pick<CommandBinding, "current" | "detail" | "journey">) {
  if (!canRunMigrationCommand(detail, "assess-readiness")) {
    return "The server has not granted the assess-readiness command. Organization role is explanatory only.";
  }
  if (current && journey?.canAssess) {
    return null;
  }
  return "Complete shadow comparison before assessing readiness.";
}
