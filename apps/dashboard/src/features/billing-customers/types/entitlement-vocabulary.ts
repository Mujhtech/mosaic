import type { EntitlementEntry, EntitlementSourceSummary, Uncertainty } from "@/generated/api"

/**
 * Frozen vocabulary for authoritative customer access.
 *
 * Phase 9A froze the words the ledger may use. Phase 9B adds the harder half:
 * this is the first Mosaic surface that states whether a person has access, and
 * the single most consequential mistake it can make is collapsing "Mosaic
 * cannot answer" into "no access". A support agent who reads `unknown` as
 * `inactive` refunds a paying customer; an operator who reads `unavailable` as
 * `inactive` concludes an outage is a churn event.
 *
 * So four access labels exist and none of them share copy or tone:
 *
 * - `active`   — a positive determination that access exists.
 * - `inactive` — a positive determination that it does not. Neutral tone: this
 *                is an answer, not a fault.
 * - `unknown`  — Mosaic declines to answer about this customer. Attention tone,
 *                always accompanied by the reason and by the explicit sentence
 *                that this is not the same as inactive.
 * - `unavailable` — Mosaic could not answer at all (billing disabled, service
 *                failure). It describes Mosaic, never the customer. Attention
 *                tone. It is never persisted on a snapshot entry, only produced
 *                at read time, which is why it is absent from `EntitlementEntry`.
 *
 * Every lookup here degrades an unrecognised member to the attention tone, never
 * to the inactive one. A contract member added after this build must read as
 * "Mosaic does not recognise this state" rather than quietly assert that a
 * paying customer has nothing.
 */

/** The read-time access vocabulary. Wider than `EntitlementEntry["state"]`. */
export type AccessState = EntitlementEntry["state"] | "unavailable"

export type AccessTone = "attention" | "negative" | "neutral" | "positive"

export const accessStates = ["active", "inactive", "unknown", "unavailable"] as const

const ACCESS_STATE_LABELS: Record<string, string> = {
  active: "Access active",
  inactive: "No access",
  unavailable: "Mosaic cannot answer",
  unknown: "Access undetermined",
}

const ACCESS_STATE_TONES: Record<string, AccessTone> = {
  active: "positive",
  // A determined absence of access is an answer, not a failure. Destructive
  // tone here trains operators to read every non-active customer as a problem
  // and makes the two states that *are* problems invisible by comparison.
  inactive: "neutral",
  unavailable: "attention",
  unknown: "attention",
}

export function accessStateLabel(value: string | undefined) {
  if (!value) return "Access undetermined"
  return ACCESS_STATE_LABELS[value] ?? "Access state Mosaic does not recognise"
}

/**
 * Tone for an access state.
 *
 * Anything this build does not recognise is `attention`. Falling back to the
 * `inactive` tone would render a future contract member as a confident denial
 * of access, which is exactly the failure the four-label split exists to
 * prevent.
 */
export function accessStateTone(value: string | undefined): AccessTone {
  if (!value) return "attention"
  return ACCESS_STATE_TONES[value] ?? "attention"
}

const UNCERTAINTY_REASON_SENTENCES: Record<string, string> = {
  conflicting_facts: "two store-confirmed facts contradict each other for this purchase",
  identity_unresolved:
    "an identity conflict froze this purchase, so Mosaic will not attribute it to either candidate",
  missing_fact: "a fact this state depends on has not arrived",
  none: "no uncertainty was recorded",
  product_unresolved: "the store confirmed a Product this Project does not map",
  projection_failed: "the last projection run for this customer failed",
  provider_unavailable: "the store could not be reached to confirm the current state",
  stale_validation: "the newest store confirmation is older than the freshness threshold",
  unsupported_provider_state: "the store reported a state this build does not model",
}

const UNCERTAINTY_REASON_LABELS: Record<string, string> = {
  conflicting_facts: "Conflicting facts",
  identity_unresolved: "Identity unresolved",
  missing_fact: "Missing fact",
  none: "None",
  product_unresolved: "Product unresolved",
  projection_failed: "Projection failed",
  provider_unavailable: "Store unavailable",
  stale_validation: "Stale validation",
  unsupported_provider_state: "Unsupported store state",
}

const EXPECTED_RESOLUTION_LABELS: Record<string, string> = {
  automatic_retry: "Mosaic retries automatically",
  customer_action: "The customer has to act",
  next_projection_run: "Resolves on the next projection run",
  next_provider_notification: "Resolves when the store sends the next notification",
  none_expected: "Nothing will resolve this on its own",
  operator_action: "An operator has to act",
}

function humanize(value: string) {
  const spaced = value.replaceAll("_", " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function uncertaintyReasonLabel(value: string | undefined) {
  if (!value) return "None"
  return UNCERTAINTY_REASON_LABELS[value] ?? humanize(value)
}

/**
 * The clause that completes the `unknown` sentence. Lower-case and without
 * terminal punctuation because it is always embedded, never rendered alone.
 */
export function uncertaintyReasonClause(value: string | undefined) {
  if (!value) return "Mosaic recorded no reason"
  return (
    UNCERTAINTY_REASON_SENTENCES[value] ??
    `the store reported ${humanize(value).toLowerCase()}, which this build does not model`
  )
}

export function expectedResolutionLabel(value: string | undefined) {
  if (!value) return "Mosaic did not state how this resolves"
  return EXPECTED_RESOLUTION_LABELS[value] ?? humanize(value)
}

/**
 * The full sentence rendered beside an access pill.
 *
 * `unknown` and `unavailable` both carry the explicit disclaimer, because the
 * pill alone is exactly the kind of two-word summary that gets screenshotted
 * into a support thread and read as a denial.
 */
export function accessStateExplanation(
  value: string | undefined,
  uncertainty?: Uncertainty | undefined,
): string {
  switch (value) {
    case "active":
      return "Mosaic has determined this customer has access."
    case "inactive":
      return "Mosaic has determined this customer does not have access. This is an answer, not a failure — the evidence was sufficient to decide."
    case "unavailable":
      return "Mosaic could not answer. This describes Mosaic's own availability, not the customer: their access is unchanged and unjudged. This is not the same as inactive."
    case "unknown":
      return `Mosaic cannot currently determine access — ${uncertaintyReasonClause(uncertainty?.reason)}. This is not the same as inactive.`
    default:
      return "Mosaic reported an access state this build does not recognise. Treat it as undetermined rather than as a denial of access, and check whether the dashboard is older than the API."
  }
}

/**
 * `unavailable` says something about Mosaic; the other three say something
 * about the customer. Surfaces use this to caption the pill correctly instead
 * of labelling a service failure as a customer attribute.
 */
export function accessStateSubject(value: string | undefined): "customer" | "mosaic" {
  return value === "unavailable" || value === "unknown" ? "mosaic" : "customer"
}

// ---------------------------------------------------------------------------
// The five separate subscription axes
// ---------------------------------------------------------------------------

/**
 * These are five axes, never one merged status.
 *
 * A cancelled subscription that still has access is the case that proves it: a
 * single merged pill has to choose between "Cancelled" (which reads as access
 * gone, and is what support agents act on) and "Active" (which hides that
 * renewal was turned off). Both are wrong. Five pills state both facts.
 */
const LIFECYCLE_STATE_LABELS: Record<string, string> = {
  active: "Active",
  billing_retry: "Billing retry",
  expired: "Expired",
  grace_period: "Grace period",
  paused: "Paused",
  refunded: "Refunded",
  revoked: "Revoked",
  superseded: "Superseded by a later purchase",
  trialing: "Trialing",
  unknown: "Lifecycle undetermined",
}

const LIFECYCLE_STATE_TONES: Record<string, AccessTone> = {
  active: "positive",
  billing_retry: "attention",
  expired: "neutral",
  grace_period: "attention",
  paused: "neutral",
  refunded: "neutral",
  revoked: "negative",
  superseded: "neutral",
  trialing: "positive",
  unknown: "attention",
}

const RENEWAL_INTENT_LABELS: Record<string, string> = {
  auto_renew_disabled: "Auto-renew disabled",
  auto_renew_enabled: "Auto-renew enabled",
  paused: "Renewal paused",
  provider_managed: "Renewal managed by the store",
  unknown: "Renewal intent undetermined",
}

const BILLING_STATE_LABELS: Record<string, string> = {
  current: "Billing current",
  failed: "Billing failed",
  grace: "Billing in grace",
  refunded: "Refunded",
  retrying: "Billing retrying",
  revoked: "Revoked",
  unknown: "Billing state undetermined",
}

const BILLING_STATE_TONES: Record<string, AccessTone> = {
  current: "positive",
  failed: "negative",
  grace: "attention",
  refunded: "neutral",
  retrying: "attention",
  revoked: "negative",
  unknown: "attention",
}

export function lifecycleStateLabel(value: string | undefined) {
  if (!value) return "Lifecycle undetermined"
  return LIFECYCLE_STATE_LABELS[value] ?? humanize(value)
}

export function lifecycleStateTone(value: string | undefined): AccessTone {
  if (!value) return "attention"
  return LIFECYCLE_STATE_TONES[value] ?? "attention"
}

export function renewalIntentLabel(value: string | undefined) {
  if (!value) return "Renewal intent undetermined"
  return RENEWAL_INTENT_LABELS[value] ?? humanize(value)
}

/**
 * Renewal intent is never an access signal. `auto_renew_disabled` on an
 * otherwise current subscription is neutral, not negative: the customer keeps
 * access until the period ends and colouring it red is what makes operators
 * revoke early.
 */
export function renewalIntentTone(value: string | undefined): AccessTone {
  if (!value) return "attention"
  return value === "unknown" ? "attention" : "neutral"
}

export function billingStateLabel(value: string | undefined) {
  if (!value) return "Billing state undetermined"
  return BILLING_STATE_LABELS[value] ?? humanize(value)
}

export function billingStateTone(value: string | undefined): AccessTone {
  if (!value) return "attention"
  return BILLING_STATE_TONES[value] ?? "attention"
}

export function uncertaintyTone(value: string | undefined): AccessTone {
  return !value || value === "none" ? "neutral" : "attention"
}

/**
 * Renders the cancellation case correctly.
 *
 * Cancellation flips renewal intent only (plan section 7). The two sentences
 * this returns are the contract with the reader: the subscription will not
 * renew, *and* access continues until the validated period end. Neither
 * sentence may be dropped, and neither may be replaced with "Cancelled".
 */
export function subscriptionAccessStatement(input: {
  accessState: string | undefined
  periodEnd: string | undefined
  renewalIntent: string | undefined
}): { access: string; renewal: string } {
  const renewal =
    input.renewalIntent === "auto_renew_disabled"
      ? "Auto-renew disabled. The store will not charge again."
      : renewalIntentLabel(input.renewalIntent)

  if (input.accessState !== "active") {
    return { access: accessStateLabel(input.accessState), renewal }
  }

  return {
    access: input.periodEnd
      ? `Active until ${formatEntitlementInstant(input.periodEnd)}`
      : "Active with no end Mosaic can state",
    renewal,
  }
}

// ---------------------------------------------------------------------------
// Explanation codes and sources
// ---------------------------------------------------------------------------

/**
 * The contract's closed explanation vocabulary
 * (`protocol/schema/authoritative-entitlement/v1`). A reader may render its own
 * copy for a code but must never invent one, so an unrecognised code renders as
 * the raw code plus an explicit "this build does not have copy for it" rather
 * than as an invented sentence.
 */
const EXPLANATION_SENTENCES: Record<string, string> = {
  active_billing_retry_allowance:
    "The store is retrying a failed charge and this Project's grant version allows access during billing retry.",
  active_grace_period:
    "The charge failed and the store opened a grace period. Both stores grant access during grace, and so does Mosaic.",
  active_subscription_period: "The store confirmed a paid period that covers this instant.",
  active_trial_period:
    "The store confirmed an introductory or free trial period covering this instant.",
  billing_disabled:
    "Mosaic Billing is turned off for this Project, so Mosaic holds no authoritative answer. This is a Mosaic state, not a customer state.",
  conflicting_facts:
    "Two store-confirmed facts contradict each other. Mosaic keeps both and declines to choose.",
  family_shared_source: "Access comes from a Family Sharing transaction on another store account.",
  grant_version_ended:
    "The grant version that applied to this purchase has ended and no later version grants this Entitlement.",
  identity_unresolved:
    "An identity conflict froze this purchase. Neither candidate customer is granted anything until an operator resolves it.",
  no_qualifying_source: "No purchase Mosaic holds grants this Entitlement at this instant.",
  permanent_one_time_purchase:
    "A non-consumable purchase grants this permanently. There is no expiry date to state.",
  product_unresolved:
    "The store confirmed a purchase of a Product this Project does not map, so Mosaic cannot say what it grants.",
  projection_failed:
    "The last projection run for this customer failed. The previously committed state is preserved rather than replaced with a guess.",
  provider_evidence_stale:
    "The newest store confirmation is older than the freshness threshold, so Mosaic will not assert the current state.",
  provider_unavailable:
    "The store could not be reached, so Mosaic will not assert the current state.",
  scheduled_pause_not_yet_effective:
    "A pause is scheduled but has not taken effect. Access continues until it does.",
  subscription_cancelled_access_until_period_end:
    "Auto-renew was turned off. Access continues until the validated period end; cancellation changes renewal intent only.",
  subscription_expired: "The paid period ended and no later period was confirmed.",
  subscription_paused: "The subscription is paused. Google's pause never grants access.",
  subscription_refunded: "The store confirmed a refund effective at the recorded instant.",
  subscription_revoked: "The store revoked this purchase effective at the recorded instant.",
  subscription_superseded:
    "A later purchase replaced this one. Nothing was deleted; the replacement is recorded explicitly.",
  unsupported_provider_state: "The store reported a state this build does not model.",
}

export function explanationSentence(code: string | undefined) {
  if (!code) return "Mosaic recorded no explanation for this entry."
  const sentence = EXPLANATION_SENTENCES[code]
  if (sentence) return sentence
  return `Mosaic reported the explanation code "${code}". This dashboard build has no copy for it, so the code is shown verbatim rather than paraphrased.`
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  active_subscription: "Active subscription",
  billing_retry: "Subscription in billing retry",
  family_shared: "Family Sharing",
  grace_period: "Subscription in grace",
  one_time_non_consumable: "One-time purchase",
  trial: "Trial",
}

export function sourceTypeLabel(value: string | undefined) {
  if (!value) return "Unclassified source"
  return SOURCE_TYPE_LABELS[value] ?? humanize(value)
}

const SOURCE_STATE_LABELS: Record<string, string> = {
  granting: "Granting access",
  not_granting: "Not granting access",
  unknown: "Contribution undetermined",
}

export function sourceStateLabel(value: string | undefined) {
  if (!value) return "Contribution undetermined"
  return SOURCE_STATE_LABELS[value] ?? humanize(value)
}

export function sourceStateTone(value: string | undefined): AccessTone {
  if (value === "granting") return "positive"
  if (value === "not_granting") return "neutral"
  return "attention"
}

/**
 * A permanent source has no finite end Mosaic can state. Rendering an empty
 * `end` as an expiry date, or as "expired", is the false-expiry bug the
 * aggregation rules exist to prevent.
 */
export function sourceEndStatement(source: Pick<EntitlementSourceSummary, "end">) {
  return source.end
    ? `Ends ${formatEntitlementInstant(source.end)}`
    : "No finite end — this source does not expire"
}

const PROJECTION_STATUS_LABELS: Record<string, string> = {
  current: "Current",
  degraded: "Degraded",
  failed: "Failed",
  pending: "Projection pending",
  stale: "Stale",
}

const PROJECTION_STATUS_EXPLANATIONS: Record<string, string> = {
  current: "The committed state reflects every fact Mosaic holds for this customer.",
  degraded:
    "Mosaic committed a state but could not use every input it wanted. Entries derived from the missing inputs read undetermined.",
  failed:
    "The last projection run failed. The previously committed state is preserved rather than replaced.",
  pending:
    "Facts are waiting to be projected. The committed state is older than the evidence, which is why entries can read undetermined rather than inactive.",
  stale: "The committed state is older than the staleness threshold for this Environment.",
}

export function projectionStatusLabel(value: string | undefined) {
  if (!value) return "Projection status unknown"
  return PROJECTION_STATUS_LABELS[value] ?? humanize(value)
}

export function projectionStatusExplanation(value: string | undefined) {
  if (!value) return "Mosaic did not report a projection status for this customer."
  return (
    PROJECTION_STATUS_EXPLANATIONS[value] ??
    "Mosaic reported a projection status this build does not recognise. Treat the committed state as possibly out of date."
  )
}

export function projectionStatusTone(value: string | undefined): AccessTone {
  if (value === "current") return "positive"
  if (value === "failed") return "negative"
  return "attention"
}

/**
 * Access arguments are made in UTC. The customer surfaces never localise, for
 * the same reason the 9A ledger does not: a period end read in two timezones is
 * two different support answers.
 */
export function formatEntitlementInstant(value: string | undefined) {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return `${parsed.toISOString().slice(0, 19).replace("T", " ")} UTC`
}

/**
 * The header pair every authoritative surface carries. `asOf` is the instant the
 * projection reasoned about; `lastProjectedAt` is when the run happened. They
 * are different clocks and are never merged, exactly as `occurredAt` and
 * `recordedAt` are not merged on the ledger.
 */
export const AUTHORITATIVE_TIMESTAMP_NOTE =
  "As of is the instant the projection reasoned about. Last projected is when the projection run committed. They are never the same clock."

/**
 * Rendered wherever an authoritative access answer appears. It is the sentence
 * the 9A boundary note now defers to.
 */
export const AUTHORITATIVE_ACCESS_NOTE =
  "Access shown here is computed only by the Mosaic projection engine from store-confirmed facts and the grant version that applied to each purchase. Nothing on these pages can grant or revoke access directly."
