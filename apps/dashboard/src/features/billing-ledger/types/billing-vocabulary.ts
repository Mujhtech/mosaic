import type { QuarantineRecord, TransactionFact, ValidationAttempt } from "@/generated/api"

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
 * Rendered in the header of every billing surface. It states the phase
 * boundary without using any of the words 9A forbids on new surfaces.
 */
export const BILLING_BOUNDARY_NOTE =
  "Mosaic Billing records store-confirmed transaction facts and their full validation history. It does not grant, revoke, or represent any person's access to your app."

/** Billing is per-Project opt-in. No empty state may read like a dead end. */
export const BILLING_OPTIONAL_NOTE =
  "Mosaic Billing is optional. Studio, Products, Paywalls, Placements, Analytics, and Experiments all work without it."

/**
 * Mosaic Environment and Store Environment are different things and are always
 * rendered as two separate, separately labelled controls and badges.
 */
export const ENVIRONMENT_DISTINCTION_NOTE =
  "Mosaic Environment is your own workspace scope. Store Environment is sandbox or production as the store itself reported it. They are separate values on every record."

export const TIMESTAMP_DISTINCTION_NOTE =
  "Occurred at is the moment the store reports. Recorded at is the moment Mosaic durably accepted the input. They are never the same clock."

export type BillingProvider = NonNullable<TransactionFact["provider"]>
export type StoreEnvironment = "production" | "sandbox"
export type ValidationOutcome = NonNullable<ValidationAttempt["outcome"]>
export type ResolutionState = NonNullable<TransactionFact["resolutionState"]>
export type QuarantineReasonCode = NonNullable<QuarantineRecord["reasonCode"]>
export type QuarantineStatus = NonNullable<QuarantineRecord["status"]>

export const billingProviders = [
  "app_store",
  "google_play",
] as const satisfies readonly BillingProvider[]

export const storeEnvironments = [
  "sandbox",
  "production",
] as const satisfies readonly StoreEnvironment[]

export const validationOutcomes = [
  "validated",
  "recorded_no_fact",
  "quarantined",
  "retryable_failure",
  "permanently_failed",
] as const satisfies readonly ValidationOutcome[]

export const resolutionStates = [
  "active_mapping",
  "archived_mapping",
  "replacement_chain",
  "unresolved",
] as const satisfies readonly ResolutionState[]

const PROVIDER_LABELS: Record<BillingProvider, string> = {
  app_store: "App Store",
  google_play: "Google Play",
}

const STORE_ENVIRONMENT_LABELS: Record<string, string> = {
  production: "Production",
  sandbox: "Sandbox",
  unclassified: "Unclassified",
}

const VALIDATION_OUTCOME_LABELS: Record<ValidationOutcome, string> = {
  permanently_failed: "Permanently failed",
  quarantined: "Quarantined",
  recorded_no_fact: "Recorded · no fact",
  retryable_failure: "Retryable failure",
  validated: "Validated",
}

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
}

const RESOLUTION_STATE_EXPLANATIONS: Record<ResolutionState, string> = {
  active_mapping: "The provider Product matched a mapping that is active today.",
  archived_mapping:
    "The provider Product matched the mapping that was live when the transaction occurred. Resolving through history is correct, not a defect.",
  replacement_chain:
    "The matched mapping had been replaced, so Mosaic followed the recorded replacement chain to the current Mosaic Product.",
  unresolved:
    "The store confirmed a real purchase of a Product Mosaic does not recognise. The input is kept as evidence; repair the mapping and re-run validation.",
}

/** The store's own transaction classification. Never a claim about access. */
const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  auto_renewable_subscription: "Auto-renewable",
  non_consumable: "Non-consumable",
}

const QUARANTINE_REASON_LABELS: Record<QuarantineReasonCode, string> = {
  application_mismatch: "Application mismatch",
  credential_revoked: "Store Server Credential revoked",
  credential_unavailable: "Store Server Credential unavailable",
  cross_environment_mismatch: "Cross-Environment mismatch",
  environment_mismatch: "Mosaic Environment mismatch",
  input_content_conflict: "Conflicting content for a known key",
  malformed_reference: "Malformed transaction reference",
  product_ambiguous: "Ambiguous Product mapping",
  product_unknown: "Unknown provider Product",
  provider_permanently_failed: "Store rejected permanently",
  replay_conflict: "Replay produced a conflicting result",
  signature_invalid: "Signature verification failed",
  store_environment_mismatch: "Store Environment mismatch",
  unsupported_product_type: "Unsupported Product type",
  unsupported_transaction_type: "Unsupported transaction type",
  validation_exhausted: "Retries exhausted",
}

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
  unsupported_product_type: "Phase 9A models auto-renewable and non-consumable Products only.",
  unsupported_transaction_type:
    "Consumables and non-renewing purchases are not modelled in this phase and are recorded rather than coerced into a type Mosaic cannot represent.",
  validation_exhausted:
    "Every retryable attempt was used without a definitive store answer. Each attempt is preserved.",
}

const QUARANTINE_STATUS_LABELS: Record<QuarantineStatus, string> = {
  closed_after_success: "Closed after a successful attempt",
  closed_superseded: "Closed as superseded",
  open: "Open",
  retrying: "Retrying",
}

function humanize(value: string) {
  const spaced = value.replaceAll("_", " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function providerLabel(value: string | undefined) {
  if (!value) return "Unknown provider"
  return PROVIDER_LABELS[value as BillingProvider] ?? humanize(value)
}

export function storeEnvironmentLabel(value: string | undefined) {
  if (!value) return "Unclassified"
  return STORE_ENVIRONMENT_LABELS[value] ?? humanize(value)
}

export function validationOutcomeLabel(value: string | undefined) {
  if (!value) return "Pending"
  return VALIDATION_OUTCOME_LABELS[value as ValidationOutcome] ?? humanize(value)
}

export function resolutionStateLabel(value: string | undefined) {
  if (!value) return "Unresolved"
  return RESOLUTION_STATE_LABELS[value as ResolutionState] ?? humanize(value)
}

export function resolutionStateExplanation(value: string | undefined) {
  if (!value) return RESOLUTION_STATE_EXPLANATIONS.unresolved
  return RESOLUTION_STATE_EXPLANATIONS[value as ResolutionState] ?? humanize(value)
}

export function transactionTypeLabel(value: string | undefined) {
  if (!value) return "Unclassified"
  return TRANSACTION_TYPE_LABELS[value] ?? humanize(value)
}

export function factKindLabel(value: string | undefined) {
  return value ? humanize(value) : "Unclassified"
}

export function ledgerEntryTypeLabel(value: string | undefined) {
  return value ? humanize(value) : "Unclassified"
}

export function quarantineReasonLabel(value: string | undefined) {
  if (!value) return "Unclassified reason"
  return QUARANTINE_REASON_LABELS[value as QuarantineReasonCode] ?? humanize(value)
}

export function quarantineReasonExplanation(value: string | undefined) {
  if (!value) return "Mosaic held this input because it could not safely proceed."
  return (
    QUARANTINE_REASON_EXPLANATIONS[value as QuarantineReasonCode] ??
    "Mosaic held this input because it could not safely proceed."
  )
}

export function quarantineStatusLabel(value: string | undefined) {
  if (!value) return "Open"
  return QUARANTINE_STATUS_LABELS[value as QuarantineStatus] ?? humanize(value)
}

/**
 * Renders a timestamp as UTC with the raw ISO value available for `title`.
 * Billing correctness arguments are made in UTC, so the view never localises.
 */
export function formatBillingTimestamp(value: string | undefined) {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return `${parsed.toISOString().slice(0, 19).replace("T", " ")} UTC`
}

export function formatDurationSeconds(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds)) return "—"
  if (seconds < 90) return `${Math.round(seconds)}s`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}
