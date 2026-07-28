import type { QuarantineRecord } from "@/generated/api"

/**
 * Quarantine recovery.
 *
 * A quarantined input is evidence that something the store confirmed could not
 * safely proceed. The one way out that can end in a Transaction Fact is asking
 * the store again. Nothing an operator can click may assert that an input is
 * valid.
 *
 * That prohibition lives here, in one pure module, for two reasons: the rule is
 * a domain rule rather than a rendering detail, and a single derivation is the
 * only place a future edit could reintroduce a force-accept path. Note what is
 * structurally absent:
 *
 * - No action kind names an operator assertion of validity.
 * - `QuarantineRecoveryOperation` is a closed union of the two audited REST
 *   operations that exist. There is no endpoint that marks an input valid, so
 *   no action can reference one.
 * - `closeSuperseded` carries `assertsAuthenticity: false`; it closes
 *   bookkeeping and produces no fact.
 */

export const QUARANTINE_RECOVERY_ACTION_KINDS = [
  "repair_product_mapping",
  "retry_provider_validation",
  "close_superseded",
  "replace_store_credential",
  "review_application_scope",
  "review_environment_scope",
] as const

export type QuarantineRecoveryActionKind = (typeof QUARANTINE_RECOVERY_ACTION_KINDS)[number]

/** The complete set of audited REST operations quarantine recovery may call. */
export type QuarantineRecoveryOperation =
  "closeQuarantineRecordSuperseded" | "retryQuarantinedInput"

export interface QuarantineRecoveryAction {
  /**
   * True only when the store is consulted again. Mosaic never records a
   * Transaction Fact from an operator's assertion, so this is the only route to
   * one.
   */
  consultsStore: boolean
  description: string
  kind: QuarantineRecoveryActionKind
  label: string
  /** Absent for navigational guidance that changes nothing. */
  operation?: QuarantineRecoveryOperation
}

const REPAIR_MAPPING: QuarantineRecoveryAction = {
  consultsStore: false,
  description:
    "Open the Mosaic Product this store Product should map to. Replacing a mapping keeps the previous one in history, so past resolutions stay reproducible.",
  kind: "repair_product_mapping",
  label: "Repair Product mapping",
}

const RETRY_VALIDATION: QuarantineRecoveryAction = {
  consultsStore: true,
  description:
    "Re-queue this input for validation. Mosaic asks the store again and appends a new Validation Attempt; the record closes only if that attempt succeeds, and the attempt is recorded as the justification.",
  kind: "retry_provider_validation",
  label: "Re-run validation",
  operation: "retryQuarantinedInput",
}

const CLOSE_SUPERSEDED: QuarantineRecoveryAction = {
  consultsStore: false,
  description:
    "Close this record because a later record replaced it. This asserts nothing about the original input's authenticity and produces no Transaction Fact.",
  kind: "close_superseded",
  label: "Close as superseded",
  operation: "closeQuarantineRecordSuperseded",
}

const REPLACE_CREDENTIAL: QuarantineRecoveryAction = {
  consultsStore: false,
  description:
    "This input cannot be validated until a working Store Server Credential exists for its Store Environment. Rotate or add one, then re-run validation.",
  kind: "replace_store_credential",
  label: "Review Store Server Credentials",
}

const REVIEW_APPLICATION_SCOPE: QuarantineRecoveryAction = {
  consultsStore: false,
  description:
    "The verified bundle or package identifier is outside this credential's Application scope. Correct the scope on the credential rather than attributing the input by hand.",
  kind: "review_application_scope",
  label: "Review Application scope",
}

const REVIEW_ENVIRONMENT_SCOPE: QuarantineRecoveryAction = {
  consultsStore: false,
  description:
    "Mosaic Environment and Store Environment must agree with the credential this input arrived on. Sandbox and production are always separate connections.",
  kind: "review_environment_scope",
  label: "Review Environment alignment",
}

type ReasonCode = NonNullable<QuarantineRecord["reasonCode"]>

const ACTIONS_BY_REASON: Record<ReasonCode, readonly QuarantineRecoveryAction[]> = {
  application_mismatch: [REVIEW_APPLICATION_SCOPE, RETRY_VALIDATION],
  credential_revoked: [REPLACE_CREDENTIAL],
  credential_unavailable: [REPLACE_CREDENTIAL, RETRY_VALIDATION],
  cross_environment_mismatch: [REVIEW_ENVIRONMENT_SCOPE, REPAIR_MAPPING],
  environment_mismatch: [REVIEW_ENVIRONMENT_SCOPE],
  // A key collision with different content is a security-severity event. The
  // original record is never overwritten, and nothing here can declare the
  // newcomer legitimate.
  input_content_conflict: [CLOSE_SUPERSEDED],
  malformed_reference: [CLOSE_SUPERSEDED],
  product_ambiguous: [REPAIR_MAPPING, RETRY_VALIDATION],
  product_unknown: [REPAIR_MAPPING, RETRY_VALIDATION],
  provider_permanently_failed: [CLOSE_SUPERSEDED],
  replay_conflict: [REPAIR_MAPPING, CLOSE_SUPERSEDED],
  signature_invalid: [],
  store_environment_mismatch: [REVIEW_ENVIRONMENT_SCOPE, REPLACE_CREDENTIAL],
  unsupported_product_type: [CLOSE_SUPERSEDED],
  unsupported_transaction_type: [CLOSE_SUPERSEDED],
  validation_exhausted: [RETRY_VALIDATION, CLOSE_SUPERSEDED],
}

/**
 * Copy for the reasons that offer no action, so the view renders an explanation
 * instead of a disabled control with no stated cause.
 */
const NO_ACTION_EXPLANATIONS: Partial<Record<ReasonCode, string>> = {
  signature_invalid:
    "A payload that fails signature verification is never accepted by retrying. Treat it as a possible forged or misdirected delivery: confirm the endpoint configured at the store, and rotate the intake token if the endpoint may have leaked.",
}

export function quarantineNoActionExplanation(reasonCode: string | undefined) {
  if (reasonCode && reasonCode in NO_ACTION_EXPLANATIONS) {
    return NO_ACTION_EXPLANATIONS[reasonCode as ReasonCode]
  }
  return "This record is closed. Its history is retained as evidence and cannot be edited."
}

/**
 * The recovery actions Mosaic offers for one record. Closed records offer none:
 * reopening a closed record by asserting an outcome is exactly the path this
 * phase excludes.
 */
export function quarantineRecoveryActions(
  record: Pick<QuarantineRecord, "reasonCode" | "status">,
): readonly QuarantineRecoveryAction[] {
  if (record.status === "closed_after_success" || record.status === "closed_superseded") return []
  if (!record.reasonCode) return []
  return ACTIONS_BY_REASON[record.reasonCode] ?? []
}
