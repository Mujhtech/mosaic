import type {
  QuarantineRecord,
  TransactionFact,
  ValidationAttempt,
} from "@/generated/api";

/**
 * Shared Mosaic Billing vocabulary.
 *
 * Phase 9A froze the words these surfaces may use. Every label an operator
 * reads is produced here rather than by humanising a raw enum member at the
 * call site, so the boundary between "a store confirmed this happened" and
 * "this person has access" cannot drift back in one component at a time.
 *
 * Three features render billing (`store-connections`, `billing-ledger`,
 * `billing-operations`). The ledger owns the vocabulary because the ledger is
 * where the recorded facts live; the other two import from here.
 */

/**
 * Rendered in the header of every ledger and ingestion surface.
 *
 * Revised in Phase 9B. The 9A wording ended "…does not grant, revoke, or
 * represent any person's access to your app", which was true while nothing in
 * Mosaic computed access. It stopped being true the moment the projection engine
 * shipped, and a note that asserts something false about the neighbouring
 * feature is worse than no note: an operator who believes Mosaic still holds no
 * access state will go looking for one somewhere else.
 *
 * The boundary it draws is now the honest one — recorded evidence here,
 * computed access under Customers — and it names where to go, because the
 * operator reading a ledger page is often there having failed to find the
 * question they actually came with.
 */
export const BILLING_BOUNDARY_NOTE =
  "Mosaic Billing records store-confirmed transaction facts and their full validation history. Nothing on these ledger pages grants or revokes access: authoritative customer access is computed from these facts only by the Mosaic projection engine, and is read under Customers.";

/** Billing is per-Project opt-in. No empty state may read like a dead end. */
export const BILLING_OPTIONAL_NOTE =
  "Mosaic Billing is optional. Studio, Products, Paywalls, Placements, Analytics, and Experiments all work without it.";

/**
 * Mosaic Environment and Store Environment are different things and are always
 * rendered as two separate, separately labelled controls and badges.
 */
export const ENVIRONMENT_DISTINCTION_NOTE =
  "Mosaic Environment is your own workspace scope. Store Environment is sandbox or production as the store itself reported it. They are separate values on every record.";

export const TIMESTAMP_DISTINCTION_NOTE =
  "Occurred at is the moment the store reports. Recorded at is the moment Mosaic durably accepted the input. They are never the same clock.";

export type BillingProvider = NonNullable<TransactionFact["provider"]>;
export type StoreEnvironment = "production" | "sandbox";
export type ValidationOutcome = NonNullable<ValidationAttempt["outcome"]>;
export type ResolutionState = NonNullable<TransactionFact["resolutionState"]>;
export type QuarantineReasonCode = NonNullable<QuarantineRecord["reasonCode"]>;
export type QuarantineStatus = NonNullable<QuarantineRecord["status"]>;

export const billingProviders = [
  "app_store",
  "google_play",
] as const satisfies readonly BillingProvider[];

export const storeEnvironments = [
  "sandbox",
  "production",
] as const satisfies readonly StoreEnvironment[];

export const resolutionStates = [
  "active_mapping",
  "archived_mapping",
  "replacement_chain",
  "unresolved",
] as const satisfies readonly ResolutionState[];

const PROVIDER_LABELS: Record<BillingProvider, string> = {
  app_store: "App Store",
  google_play: "Google Play",
};

const STORE_ENVIRONMENT_LABELS: Record<string, string> = {
  production: "Production",
  sandbox: "Sandbox",
  unclassified: "Unclassified",
};

const VALIDATION_OUTCOME_LABELS: Record<ValidationOutcome, string> = {
  permanently_failed: "Permanently failed",
  quarantined: "Quarantined",
  recorded_no_fact: "Recorded · no fact",
  retryable_failure: "Retryable failure",
  validated: "Validated",
};

/**
 * Resolution vocabulary stays ingestion-shaped. `archived_mapping` and
 * `replacement_chain` are correct historical outcomes, not defects, so their
 * copy says so.
 */
const RESOLUTION_STATE_LABELS: Record<ResolutionState, string> = {
  active_mapping: "Resolved · active mapping",
  archived_mapping: "Resolved · archived mapping",
  replacement_chain: "Resolved · replacement chain",
  unresolved: "Unresolved",
};

const RESOLUTION_STATE_EXPLANATIONS: Record<ResolutionState, string> = {
  active_mapping:
    "The provider Product matched a mapping that is active today.",
  archived_mapping:
    "The provider Product matched the mapping that was live when the transaction occurred. Resolving through history is correct, not a defect.",
  replacement_chain:
    "The matched mapping had been replaced, so Mosaic followed the recorded replacement chain to the current Mosaic Product.",
  unresolved:
    "The store confirmed a real purchase of a Product Mosaic does not recognise. The input is kept as evidence; repair the mapping and re-run validation.",
};

/** The store's own transaction classification. Never a claim about access. */
const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  auto_renewable_subscription: "Auto-renewable",
  non_consumable: "Non-consumable",
};

const QUARANTINE_REASON_LABELS: Record<QuarantineReasonCode, string> = {
  application_mismatch: "Application mismatch",
  credential_revoked: "Store Server Credential revoked",
  credential_unavailable: "Store Server Credential unavailable",
  cross_environment_mismatch: "Cross-Environment mismatch",
  environment_mismatch: "Mosaic Environment mismatch",
  input_content_conflict: "Conflicting content for a known key",
  malformed_reference: "Malformed transaction reference",
  missing_validation_credential: "No Store Server Credential for this scope",
  product_ambiguous: "Ambiguous Product mapping",
  product_unknown: "Unknown provider Product",
  provider_permanently_failed: "Store rejected permanently",
  replay_conflict: "Replay produced a conflicting result",
  signature_invalid: "Signature verification failed",
  store_environment_mismatch: "Store Environment mismatch",
  unsupported_product_type: "Unsupported Product type",
  unsupported_transaction_type: "Unsupported transaction type",
  validation_exhausted: "Retries exhausted",
};

const QUARANTINE_REASON_EXPLANATIONS: Record<QuarantineReasonCode, string> = {
  application_mismatch:
    "The verified bundle or package identifier in the store payload is not in this credential's Application scope. Mosaic refuses to attribute it to a tenant that merely owns the endpoint.",
  credential_revoked:
    "The Store Server Credential this input needs has been revoked, so no store lookup can be made.",
  credential_unavailable:
    "The Store Server Credential could not be used. It may be expired, rejected by the store, or unreadable under the current keyring.",
  cross_environment_mismatch:
    "The candidate mapping belongs to a different Mosaic Environment. Resolution never crosses Environments.",
  environment_mismatch:
    "The input arrived on a credential registered for a different Mosaic Environment.",
  input_content_conflict:
    "A second input reused an existing idempotency key with different content. The original record was preserved untouched and this one was held for review.",
  malformed_reference:
    "The transaction reference did not have a shape the store could be asked about.",
  missing_validation_credential:
    "No Store Server Credential exists for this provider and Mosaic Environment, so no store lookup can be made. Add a credential for the scope, then retry validation.",
  product_ambiguous:
    "More than one mapping matched. Mosaic never picks by display name, price, billing period, or approximate match.",
  product_unknown:
    "The store confirmed a Product that has no mapping in this Project. Add or repair the mapping, then re-run validation.",
  provider_permanently_failed:
    "The store answered with a permanent failure. Retrying without changing anything would produce the same answer.",
  replay_conflict:
    "A replay produced a result that contradicts the earlier attempt. Both are retained; nothing was overwritten.",
  signature_invalid:
    "The notification signature did not verify against the pinned store root certificate. Treat this as a possible forged or misdirected delivery.",
  store_environment_mismatch:
    "The Store Environment the store reported does not match the one this credential is registered for. Sandbox and production never mix.",
  unsupported_product_type:
    "Phase 9A models auto-renewable and non-consumable Products only.",
  unsupported_transaction_type:
    "Consumables and non-renewing purchases are not modelled in this phase and are recorded rather than coerced into a type Mosaic cannot represent.",
  validation_exhausted:
    "Every retryable attempt was used without a definitive store answer. Each attempt is preserved.",
};

const QUARANTINE_STATUS_LABELS: Record<QuarantineStatus, string> = {
  closed_after_success: "Closed after a successful attempt",
  closed_superseded: "Closed as superseded",
  open: "Open",
  retrying: "Retrying",
};

const QUARANTINE_SEVERITY_LABELS: Record<string, string> = {
  error: "Error",
  security: "Security",
  warning: "Warning",
};

/**
 * Worker-queue states an operator should never have to decode. "Leased" means a
 * worker has picked the job up, which is "Running" from the outside.
 */
const RUN_STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  failed: "Failed",
  leased: "Running",
  partial: "Completed with failures",
  queued: "Queued",
};

const RUN_TRIGGER_LABELS: Record<string, string> = {
  manual: "Started by an operator",
  scheduled: "Scheduled",
};

const RECONCILIATION_STRATEGY_LABELS: Record<string, string> = {
  apple_notification_history: "App Store · notification history",
  apple_transaction_history: "App Store · transaction history",
  google_token_requery: "Google Play · re-query known purchases",
};

const REPLAY_KIND_LABELS: Record<string, string> = {
  replay: "Replay",
  revalidation: "Revalidation",
};

const REPLAY_COMPARISON_LABELS: Record<string, string> = {
  conflicting: "Conflicting with recorded facts",
  identical: "Identical to the recorded result",
  new_facts: "New facts recorded",
  still_failing: "Still failing",
};

const REPLAY_COMPARISON_EXPLANATIONS: Record<string, string> = {
  conflicting:
    "At least one input produced a result that contradicts the fact already on record. Both are retained and nothing was overwritten; each conflict also opens a quarantine record.",
  identical:
    "Every input recomputed the same fact digest, so nothing was written. This is the expected outcome of a replay against unchanged mappings.",
  new_facts:
    "The store answered with something Mosaic had not recorded before, so new facts were appended beside the existing ones.",
  still_failing:
    "The store still could not confirm these inputs. Every attempt is preserved, and permanently failing inputs stay quarantined.",
};

const CREDENTIAL_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  revoked: "Revoked",
};

function humanize(value: string) {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function providerLabel(value: string | undefined) {
  if (!value) {
    return "Unknown provider";
  }
  return PROVIDER_LABELS[value as BillingProvider] ?? humanize(value);
}

export function storeEnvironmentLabel(value: string | undefined) {
  if (!value) {
    return "Unclassified";
  }
  return STORE_ENVIRONMENT_LABELS[value] ?? humanize(value);
}

export function validationOutcomeLabel(value: string | undefined) {
  if (!value) {
    return "Pending";
  }
  return (
    VALIDATION_OUTCOME_LABELS[value as ValidationOutcome] ?? humanize(value)
  );
}

export function resolutionStateLabel(value: string | undefined) {
  if (!value) {
    return "Unresolved";
  }
  return RESOLUTION_STATE_LABELS[value as ResolutionState] ?? humanize(value);
}

export function resolutionStateExplanation(value: string | undefined) {
  if (!value) {
    return RESOLUTION_STATE_EXPLANATIONS.unresolved;
  }
  return (
    RESOLUTION_STATE_EXPLANATIONS[value as ResolutionState] ?? humanize(value)
  );
}

export function transactionTypeLabel(value: string | undefined) {
  if (!value) {
    return "Unclassified";
  }
  return TRANSACTION_TYPE_LABELS[value] ?? humanize(value);
}

export function factKindLabel(value: string | undefined) {
  return value ? humanize(value) : "Unclassified";
}

export function ledgerEntryTypeLabel(value: string | undefined) {
  return value ? humanize(value) : "Unclassified";
}

export function quarantineReasonLabel(value: string | undefined) {
  if (!value) {
    return "Unclassified reason";
  }
  return (
    QUARANTINE_REASON_LABELS[value as QuarantineReasonCode] ?? humanize(value)
  );
}

export function quarantineReasonExplanation(value: string | undefined) {
  if (!value) {
    return "Mosaic held this input because it could not safely proceed.";
  }
  return (
    QUARANTINE_REASON_EXPLANATIONS[value as QuarantineReasonCode] ??
    "Mosaic held this input because it could not safely proceed."
  );
}

export function quarantineSeverityLabel(value: string | undefined) {
  if (!value) {
    return "Warning";
  }
  return QUARANTINE_SEVERITY_LABELS[value] ?? humanize(value);
}

/** Shared by reconciliation runs and replay jobs: both are worker-queue jobs. */
export function runStatusLabel(value: string | undefined) {
  if (!value) {
    return "Queued";
  }
  return RUN_STATUS_LABELS[value] ?? humanize(value);
}

export function runTriggerLabel(value: string | undefined) {
  if (!value) {
    return "—";
  }
  return RUN_TRIGGER_LABELS[value] ?? humanize(value);
}

export function reconciliationStrategyLabel(value: string | undefined) {
  if (!value) {
    return "—";
  }
  return RECONCILIATION_STRATEGY_LABELS[value] ?? humanize(value);
}

export function replayKindLabel(value: string | undefined) {
  if (!value) {
    return "Replay";
  }
  return REPLAY_KIND_LABELS[value] ?? humanize(value);
}

export function replayComparisonLabel(value: string | undefined) {
  if (!value) {
    return "Not compared yet";
  }
  return REPLAY_COMPARISON_LABELS[value] ?? humanize(value);
}

export function replayComparisonExplanation(value: string | undefined) {
  if (!value) {
    return "Mosaic has not finished re-running these inputs. Every attempt it makes is appended; nothing already recorded changes.";
  }
  return (
    REPLAY_COMPARISON_EXPLANATIONS[value] ??
    "Every attempt is appended; nothing already recorded changes."
  );
}

export function credentialStatusLabel(value: string | undefined) {
  if (!value) {
    return "—";
  }
  return CREDENTIAL_STATUS_LABELS[value] ?? humanize(value);
}

export function quarantineStatusLabel(value: string | undefined) {
  if (!value) {
    return "Open";
  }
  return QUARANTINE_STATUS_LABELS[value as QuarantineStatus] ?? humanize(value);
}

/**
 * Renders a timestamp as UTC with the raw ISO value available for `title`.
 * Billing correctness arguments are made in UTC, so the view never localises.
 */
export function formatBillingTimestamp(value: string | undefined) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return `${parsed.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * The word every billing surface uses for a counter the API did not send.
 *
 * "Not reported" is deliberately not "0" and not "—". An operator reading a
 * health page is deciding whether to page someone, and the two answers "the
 * store produced no failures" and "Mosaic was never told how many failures
 * there were" lead to opposite decisions.
 */
export const NOT_REPORTED_LABEL = "Not reported";

export type BillingMetricTone =
  | "attention"
  | "negative"
  | "neutral"
  | "positive";

/** Whether the API actually reported this counter. */
export function isReportedCount(
  value: number | null | undefined
): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Renders a counter, or the shared not-reported wording when it is absent. */
export function formatReportedCount(value: number | null | undefined) {
  return isReportedCount(value) ? String(value) : NOT_REPORTED_LABEL;
}

/**
 * Tone for a counter where a non-zero value is the interesting case.
 *
 * An absent counter resolves to `neutral`, never to `zeroTone`. This is the one
 * rule the whole helper exists for: a page must not paint a green "positive"
 * pill from a field the server never sent, because that is a claim of health
 * made from no evidence at all.
 */
export function reportedCountTone(
  value: number | null | undefined,
  nonZeroTone: "attention" | "negative",
  zeroTone: "neutral" | "positive"
): BillingMetricTone {
  if (!isReportedCount(value)) {
    return "neutral";
  }
  return value > 0 ? nonZeroTone : zeroTone;
}

export function formatDurationSeconds(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return "—";
  }
  if (seconds < 90) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 5400) {
    return `${Math.round(seconds / 60)} min`;
  }
  return `${Math.round(seconds / 3600)} h`;
}
