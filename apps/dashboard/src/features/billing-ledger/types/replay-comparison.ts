import {
  formatBillingTimestamp,
  resolutionStateLabel,
  storeEnvironmentLabel,
  validationOutcomeLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import type { TransactionFact, ValidationAttempt } from "@/generated/api";

/**
 * Replay comparison.
 *
 * Replay appends a Validation Attempt; it never rewrites one. This module turns
 * two attempts (and the facts they produced, when the store answered) into a
 * two-column, append-only comparison. There is deliberately no operation here
 * that merges, chooses, supersedes, or discards a column: an "apply the new
 * result" affordance cannot be built from this shape.
 */

/**
 * Orders Validation Attempts oldest-first, with unnumbered attempts last.
 *
 * Substituting `0` for a missing attempt number sorted those attempts to the
 * very front, where "oldest" and "newest" are read off the ends: a single
 * unnumbered record could silently become the baseline of a replay comparison,
 * or be picked as the latest result. An attempt with no number has no position,
 * so it is parked at the end instead of being given a false one.
 */
export function compareAttemptNumberAscending(
  a: ValidationAttempt,
  b: ValidationAttempt
) {
  const left = a.attemptNumber;
  const right = b.attemptNumber;
  if (typeof left !== "number") {
    return typeof right === "number" ? 1 : 0;
  }
  if (typeof right !== "number") {
    return -1;
  }
  return left - right;
}

/** Newest first, still with unnumbered attempts last rather than first. */
export function compareAttemptNumberDescending(
  a: ValidationAttempt,
  b: ValidationAttempt
) {
  const left = a.attemptNumber;
  const right = b.attemptNumber;
  if (typeof left !== "number") {
    return typeof right === "number" ? 1 : 0;
  }
  if (typeof right !== "number") {
    return -1;
  }
  return right - left;
}

export interface ReplayComparisonRow {
  changed: boolean;
  earlier: string;
  label: string;
  latest: string;
}

export type ReplayConflictKind =
  | "outcome_changed"
  | "resolved_product_changed"
  | "store_environment_changed";

export interface ReplayComparison {
  conflicts: readonly ReplayConflictKind[];
  /** Both attempts are always present in the result. */
  earlierAttemptNumber?: number;
  hasConflict: boolean;
  latestAttemptNumber?: number;
  rows: readonly ReplayComparisonRow[];
}

export interface ReplayComparisonInput {
  attempt: ValidationAttempt;
  fact?: TransactionFact;
}

const CONFLICT_EXPLANATIONS: Record<ReplayConflictKind, string> = {
  outcome_changed:
    "The store answered differently this time. Both attempts are retained and neither result was overwritten.",
  resolved_product_changed:
    "The same transaction now resolves to a different Mosaic Product. Review the Product mapping history before relying on either resolution.",
  store_environment_changed:
    "The Store Environment differs between attempts. Sandbox and production facts must never be treated as one series.",
};

export function describeReplayConflict(kind: ReplayConflictKind) {
  return CONFLICT_EXPLANATIONS[kind];
}

/**
 * Orders two attempts by attempt number so a caller cannot mislabel which one
 * is the history and which is the replay. Ties fall back to `startedAt`, and
 * an unorderable pair keeps the caller's order.
 */
export function orderReplayAttempts(
  a: ReplayComparisonInput,
  b: ReplayComparisonInput
): [ReplayComparisonInput, ReplayComparisonInput] {
  const left = a.attempt.attemptNumber;
  const right = b.attempt.attemptNumber;
  if (typeof left === "number" && typeof right === "number" && left !== right) {
    return left < right ? [a, b] : [b, a];
  }
  const leftStarted = Date.parse(a.attempt.startedAt ?? "");
  const rightStarted = Date.parse(b.attempt.startedAt ?? "");
  if (
    !(Number.isNaN(leftStarted) || Number.isNaN(rightStarted)) &&
    leftStarted !== rightStarted
  ) {
    return leftStarted < rightStarted ? [a, b] : [b, a];
  }
  return [a, b];
}

function row(
  label: string,
  earlier: string,
  latest: string
): ReplayComparisonRow {
  return { changed: earlier !== latest, earlier, label, latest };
}

const UNSET = "—";

function text(value: string | number | undefined) {
  return value === undefined || value === "" ? UNSET : String(value);
}

export function compareReplayAttempts(
  first: ReplayComparisonInput,
  second: ReplayComparisonInput
): ReplayComparison {
  const [earlier, latest] = orderReplayAttempts(first, second);

  const rows: ReplayComparisonRow[] = [
    row(
      "Attempt",
      text(earlier.attempt.attemptNumber),
      text(latest.attempt.attemptNumber)
    ),
    row(
      "Outcome",
      validationOutcomeLabel(earlier.attempt.outcome),
      validationOutcomeLabel(latest.attempt.outcome)
    ),
    row(
      "Store Environment",
      storeEnvironmentLabel(earlier.attempt.storeEnvironment),
      storeEnvironmentLabel(latest.attempt.storeEnvironment)
    ),
    row(
      "Diagnostic code",
      text(earlier.attempt.diagnosticCode),
      text(latest.attempt.diagnosticCode)
    ),
    row(
      "Store code",
      text(earlier.attempt.providerCode),
      text(latest.attempt.providerCode)
    ),
    row(
      "Store HTTP status",
      text(earlier.attempt.providerHttpStatus),
      text(latest.attempt.providerHttpStatus)
    ),
    row(
      "Validator version",
      text(earlier.attempt.validatorVersion),
      text(latest.attempt.validatorVersion)
    ),
    row(
      "Completed at",
      formatBillingTimestamp(earlier.attempt.completedAt),
      formatBillingTimestamp(latest.attempt.completedAt)
    ),
    row(
      "Resolved Mosaic Product",
      text(earlier.fact?.mosaicProductId),
      text(latest.fact?.mosaicProductId)
    ),
    row(
      "Resolution",
      earlier.fact ? resolutionStateLabel(earlier.fact.resolutionState) : UNSET,
      latest.fact ? resolutionStateLabel(latest.fact.resolutionState) : UNSET
    ),
    row(
      "Mapping version",
      text(earlier.fact?.resolvedMappingVersion),
      text(latest.fact?.resolvedMappingVersion)
    ),
  ];

  const conflicts: ReplayConflictKind[] = [];
  if (
    earlier.attempt.outcome !== undefined &&
    latest.attempt.outcome !== undefined &&
    earlier.attempt.outcome !== latest.attempt.outcome
  ) {
    conflicts.push("outcome_changed");
  }
  if (
    earlier.fact?.mosaicProductId !== undefined &&
    latest.fact?.mosaicProductId !== undefined &&
    earlier.fact.mosaicProductId !== latest.fact.mosaicProductId
  ) {
    conflicts.push("resolved_product_changed");
  }
  if (
    earlier.attempt.storeEnvironment !== undefined &&
    latest.attempt.storeEnvironment !== undefined &&
    earlier.attempt.storeEnvironment !== latest.attempt.storeEnvironment
  ) {
    conflicts.push("store_environment_changed");
  }

  return {
    conflicts,
    ...(earlier.attempt.attemptNumber === undefined
      ? {}
      : { earlierAttemptNumber: earlier.attempt.attemptNumber }),
    hasConflict: conflicts.length > 0,
    ...(latest.attempt.attemptNumber === undefined
      ? {}
      : { latestAttemptNumber: latest.attempt.attemptNumber }),
    rows,
  };
}

/**
 * Picks the two attempts a comparison should show: the newest attempt against
 * the newest one before it. Earlier attempts stay in the attempt history panel;
 * none is ever removed.
 *
 * An attempt with no `attemptNumber` has no place in the sequence, so it is not
 * eligible to be either column. It used to be sorted as if it were attempt 0,
 * which made it the baseline the operator judged the newest result against.
 * Skipping it is the honest option: the attempt is still shown in full in the
 * attempts panel, it simply cannot anchor an ordering it does not participate
 * in.
 */
export function selectComparableAttempts(
  attempts: readonly ValidationAttempt[],
  factsByAttemptId: ReadonlyMap<string, TransactionFact> = new Map()
): [ReplayComparisonInput, ReplayComparisonInput] | undefined {
  const sequenced = attempts.filter(
    (attempt) => typeof attempt.attemptNumber === "number"
  );
  if (sequenced.length < 2) {
    return;
  }
  const ordered = sequenced.toSorted(compareAttemptNumberAscending);
  const latest = ordered.at(-1);
  const earlier = ordered.at(-2);
  if (!(latest && earlier)) {
    return;
  }
  const withFact = (attempt: ValidationAttempt): ReplayComparisonInput => {
    const fact = attempt.id ? factsByAttemptId.get(attempt.id) : undefined;
    return fact ? { attempt, fact } : { attempt };
  };
  return [withFact(earlier), withFact(latest)];
}
