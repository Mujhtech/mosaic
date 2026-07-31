import type {
  GrantVersionImpact,
  PublishGrantVersionRequest,
} from "@/generated/api";

/**
 * What a Product grants, versioned.
 *
 * A grant version is selected by the *purchase's own effective time*, not by
 * "now", so a published version is a historical fact about what someone bought.
 * Editing one would change what a customer was entitled to at an instant that
 * has already passed, which is why the API answers `409 grant_version_immutable`
 * to PATCH, PUT, and DELETE alike and the database permits only one update ever
 * (closing an open interval).
 *
 * This module holds the rules the UI has to enforce so an operator meets the
 * refusal as a sentence rather than as a failed request:
 *
 * 1. There is no edit affordance on a published version, ever. The only forward
 *    action is "Create new version".
 * 2. Publishing is gated on having previewed *this exact proposal*. Preview is
 *    free, repeatable, and writes nothing — including no audit event — so there
 *    is no cost to requiring it, and `impactedActiveSources` is the only number
 *    that answers "how many people could lose access".
 */

export type GrantProposal = PublishGrantVersionRequest;

/** Every published version is immutable. The function exists to say so once. */
export function isGrantVersionEditable() {
  return false;
}

const NARROWING_CODE_SENTENCES: Record<string, string> = {
  active_access_narrowed:
    "The version in force grants access during an active paid period and this proposal does not. A retroactive change may only widen access.",
  billing_retry_access_narrowed:
    "The version in force grants access during billing retry and this proposal does not. A retroactive change may only widen access.",
  grace_access_narrowed:
    "The version in force grants access during the store's grace period and this proposal does not. A retroactive change may only widen access.",
  grant_identity_changed:
    "The proposal names a different Product or Entitlement than the version it would replace. A version history belongs to one pair.",
  one_time_access_narrowed:
    "The version in force grants access from a one-time purchase and this proposal does not. A retroactive change may only widen access.",
  purchase_type_support_narrowed:
    "The version in force supports a purchase type this proposal drops. Purchases already made under it would be left granting nothing.",
  trial_access_narrowed:
    "The version in force grants access during a trial and this proposal does not. A retroactive change may only widen access.",
};

function humanize(value: string) {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function narrowingCodeExplanation(code: string | undefined) {
  if (!code) {
    return;
  }
  return (
    NARROWING_CODE_SENTENCES[code] ??
    `Mosaic reported the narrowing "${humanize(code).toLowerCase()}". A retroactive grant version may add Entitlements or widen access policy, never remove or narrow either.`
  );
}

const POLICY_LABELS: Record<keyof GrantAccessPolicyFields, string> = {
  grantsInActive: "Active paid period",
  grantsInBillingRetry: "Billing retry",
  grantsInGrace: "Store grace period",
  grantsInOneTimeOwnership: "One-time purchase ownership",
  grantsInTrial: "Trial period",
};

interface GrantAccessPolicyFields {
  grantsInActive?: boolean;
  grantsInBillingRetry?: boolean;
  grantsInGrace?: boolean;
  grantsInOneTimeOwnership?: boolean;
  grantsInTrial?: boolean;
}

export const grantPolicyFields = Object.keys(
  POLICY_LABELS
) as (keyof GrantAccessPolicyFields)[];

export function grantPolicyLabel(field: keyof GrantAccessPolicyFields) {
  return POLICY_LABELS[field];
}

const POLICY_NOTES: Partial<Record<keyof GrantAccessPolicyFields, string>> = {
  grantsInBillingRetry:
    "Contradicts both stores' documentation: neither grants access while a charge is being retried. Only an organization owner may turn this on.",
  grantsInGrace:
    "Both stores grant access during grace, so this is on by default.",
};

export function grantPolicyNote(field: keyof GrantAccessPolicyFields) {
  return POLICY_NOTES[field];
}

/**
 * Google's pause never grants access and the policy is not overridable, so the
 * form never offers it. The API accepts `grantsInPaused` only in order to refuse
 * it with 422; offering a control whose only outcome is a refusal is worse than
 * stating the rule.
 */
export const PAUSE_POLICY_NOTE =
  "Google's pause never grants access. That is fixed and cannot be overridden by a grant version.";

/**
 * A stable identity for a proposal.
 *
 * The publish gate compares this against the proposal the preview was taken
 * for. Any field the operator changes after previewing invalidates the
 * confirmation, because the number they were shown — how many customers could
 * lose access — no longer describes what they are about to publish.
 */
export function proposalFingerprint(proposal: GrantProposal) {
  return JSON.stringify([
    proposal.productId,
    proposal.entitlementId,
    proposal.effectiveStart,
    proposal.retroactive === true,
    [...(proposal.supportedPurchaseTypes ?? [])].sort(),
    proposal.grantsInActive === true,
    proposal.grantsInTrial === true,
    proposal.grantsInGrace === true,
    proposal.grantsInBillingRetry === true,
    proposal.grantsInOneTimeOwnership === true,
  ]);
}

export type PublishBlockedReason =
  | "already_publishing"
  | "incomplete"
  | "narrowing"
  | "no_permission"
  | "preview_stale"
  | "reason_required";

export interface PublishGate {
  allowed: boolean;
  blockedBy?: PublishBlockedReason;
  explanation?: string;
}

const BLOCKED_EXPLANATIONS: Record<PublishBlockedReason, string> = {
  already_publishing: "Mosaic is publishing this version.",
  incomplete:
    "Choose a Product, an Entitlement, and the instant the new version takes effect.",
  narrowing:
    "This retroactive proposal would take access away. The publish call would refuse it, so it is refused here too.",
  no_permission:
    "Publishing a grant version requires organization owner or admin permission.",
  preview_stale:
    "Preview the impact of this exact proposal first. The confirmation has to state how many customers could lose access, and that number changes with every field.",
  reason_required:
    "Give the reason for this change. It is what an investigation reads months from now.",
};

/**
 * The one place that decides whether "Publish" is enabled.
 *
 * The preview requirement is not a nicety: a retroactive narrowing is the only
 * operation in Mosaic that can take access from a customer who did nothing
 * wrong, and `impactedActiveSources` is the number that describes it. Enabling
 * publish before that number has been shown for the *current* proposal would
 * make the confirmation describe something adjacent to what is published.
 */
export function evaluatePublishGate(input: {
  canManage: boolean;
  impact: GrantVersionImpact | undefined;
  isSubmitting: boolean;
  previewedFingerprint: string | undefined;
  proposal: GrantProposal;
}): PublishGate {
  const gate = (blockedBy: PublishBlockedReason): PublishGate => ({
    allowed: false,
    blockedBy,
    explanation: BLOCKED_EXPLANATIONS[blockedBy],
  });

  if (!input.canManage) {
    return gate("no_permission");
  }
  if (input.isSubmitting) {
    return gate("already_publishing");
  }
  if (
    !(
      input.proposal.productId &&
      input.proposal.entitlementId &&
      input.proposal.effectiveStart
    )
  ) {
    return gate("incomplete");
  }
  if (!input.proposal.reason || input.proposal.reason.trim().length === 0) {
    return gate("reason_required");
  }
  if (
    !input.impact ||
    input.previewedFingerprint !== proposalFingerprint(input.proposal)
  ) {
    return gate("preview_stale");
  }
  if (input.impact.additiveSuperset === false) {
    return gate("narrowing");
  }

  return { allowed: true };
}

/**
 * The sentence the confirmation step leads with.
 *
 * `impactedActiveSources` comes first and in words, because "12" beside a label
 * is read as a statistic while "12 customers could lose access" is read as a
 * decision.
 */
export function impactHeadline(impact: GrantVersionImpact | undefined) {
  if (!impact) {
    return "Nothing has been previewed yet.";
  }
  const active = impact.impactedActiveSources ?? 0;
  if (active === 0) {
    return "No purchase currently granting access cites this Product, so no customer can lose access from this change.";
  }
  return `${active} purchase${active === 1 ? "" : "s"} currently granting access cite this Product. That is how many customers could lose access if this change narrows what it grants.`;
}

/** Half-open `[start, end)`. The absent end is the version in force now. */
export function grantIntervalLabel(
  effectiveStart: string | undefined,
  effectiveEnd: string | undefined
) {
  const start = effectiveStart ?? "—";
  return effectiveEnd
    ? `${start} → ${effectiveEnd}`
    : `${start} → in force now`;
}
