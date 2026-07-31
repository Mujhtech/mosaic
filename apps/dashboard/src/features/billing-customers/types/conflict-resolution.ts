import type { ResolveIdentityConflictRequest } from "@/generated/api";

/**
 * Resolving an identity conflict.
 *
 * An open conflict means two Billing Customers both have a claim on the same
 * purchase or alias, and Mosaic has frozen the disputed subject rather than
 * pick one. Resolving it moves real purchases between real people, so there is
 * deliberately no one-click merge anywhere in this feature and no heuristic
 * that reaches a resolution on its own — automatic merge stays an ADR
 * checkpoint, not something a dashboard button does.
 *
 * What replaces it is a sequence the operator cannot skip: choose the
 * resolution, read the consequence of that specific choice, write down why,
 * then acknowledge it explicitly.
 */

export type ConflictAction = ResolveIdentityConflictRequest["action"];

export const conflictActions = [
  "keep_existing",
  "reassign_to_candidate",
  "operator_split",
] as const satisfies readonly ConflictAction[];

const ACTION_LABELS: Record<ConflictAction, string> = {
  keep_existing: "Keep the existing customer",
  operator_split: "Split — neither claim wins",
  reassign_to_candidate: "Reassign to the candidate",
};

export function conflictActionLabel(value: string | undefined) {
  if (!value) {
    return "No resolution recorded";
  }
  return ACTION_LABELS[value as ConflictAction] ?? value.replaceAll("_", " ");
}

/**
 * The consequence sentence.
 *
 * Each one names what happens to *both* parties, because the failure this
 * screen exists to prevent is an operator who reads only the outcome for the
 * customer in front of them and does not notice that the other one loses
 * access.
 */
const ACTION_CONSEQUENCES: Record<ConflictAction, string> = {
  keep_existing:
    "The disputed purchase stays with the customer that already held it. The challenger keeps whatever it held before and gains nothing from this purchase — if a real person is behind the challenger, they will still have no access to what this purchase grants. Projection unfreezes and recomputes from the existing association.",
  operator_split:
    "Neither customer takes the disputed purchase. Both are unfrozen and reprojected without it, so whichever person actually made the purchase loses the access it grants until the association is established again. Choose this when the evidence does not identify an owner and granting the wrong person access is worse than granting nobody.",
  reassign_to_candidate:
    "The disputed purchase moves to the challenger. The customer that held it is reprojected without it, so if it was their only source they lose the access it grants — immediately, and without anything on their side changing. Both customers are unfrozen and recomputed.",
};

export function conflictActionConsequence(value: ConflictAction) {
  return ACTION_CONSEQUENCES[value];
}

const DIAGNOSTIC_EXPLANATIONS: Record<string, string> = {
  application_user_alias_claims_two_customers:
    "One application user ID was asserted for two different Billing Customers, each with its own purchases. Login attaches an alias; it never merges customers, so Mosaic held both rather than combining them.",
  multiple_customers_claim_lineage:
    "Two Billing Customers hold evidence claiming the same Purchase Lineage. Only one person made the purchase, so at most one claim is right.",
  reassignment_requires_operator_resolution:
    "New evidence would move an already-associated purchase to a different customer. Reassignment is never automatic: it is the operation that can silently take access from whoever holds it now.",
};

export function conflictDiagnosticExplanation(value: string | undefined) {
  if (!value) {
    return "Mosaic recorded no diagnostic for this conflict.";
  }
  return (
    DIAGNOSTIC_EXPLANATIONS[value] ??
    "Mosaic recorded a diagnostic this build does not have copy for. The conflict is still frozen and still requires a deliberate resolution."
  );
}

export const CONFLICT_FREEZE_NOTE =
  "While this conflict is open the disputed subject is frozen: access is granted to neither candidate, the last committed state is preserved, and nothing is merged automatically.";

/**
 * Conflicts are Project-scoped while most billing surfaces are
 * Environment-scoped, so the list says so rather than appearing to be filtered
 * to the Environment in the address. An operator who assumes the narrower scope
 * would conclude a conflict was resolved when it merely belongs to a sibling
 * Environment.
 */
export const CONFLICT_PROJECT_SCOPE_NOTE =
  "Identity conflicts are Project-wide. A Billing Customer's identity belongs to the Project, so this list is not filtered to the Mosaic Environment in the address and may include conflicts about purchases in another Environment.";

export type ResolutionBlockedReason =
  | "acknowledgement_required"
  | "action_required"
  | "already_resolving"
  | "assignment_mismatch"
  | "no_permission"
  | "reason_required";

export interface ResolutionGate {
  allowed: boolean;
  blockedBy?: ResolutionBlockedReason;
  explanation?: string;
}

const BLOCKED_EXPLANATIONS: Record<ResolutionBlockedReason, string> = {
  acknowledgement_required:
    "Confirm you have read what happens to both customers. This moves real purchases between real people and cannot be undone by re-running it.",
  action_required: "Choose how this conflict should be resolved.",
  already_resolving: "Mosaic is recording this resolution.",
  assignment_mismatch:
    "The customer named for assignment does not match the resolution chosen. Mosaic refuses a resolution whose stated winner and stated action disagree.",
  no_permission:
    "Resolving an identity conflict requires organization owner or admin permission.",
  reason_required:
    "Give the reason for this resolution. It is recorded on the conflict and on the audit event, and it is what an investigation reads when someone asks why their purchase moved.",
};

/**
 * The single decision point for whether the resolution can be submitted.
 *
 * Every condition is required simultaneously, so there is no ordering in which
 * an operator reaches a submittable state without having seen the consequence
 * and written down a reason.
 */
export function evaluateResolutionGate(input: {
  acknowledged: boolean;
  action: string | undefined;
  assignedBillingCustomerId?: string | undefined;
  canManage: boolean;
  firstCustomerId?: string | undefined;
  isSubmitting: boolean;
  reason: string;
  secondCustomerId?: string | undefined;
}): ResolutionGate {
  const gate = (blockedBy: ResolutionBlockedReason): ResolutionGate => ({
    allowed: false,
    blockedBy,
    explanation: BLOCKED_EXPLANATIONS[blockedBy],
  });

  if (!input.canManage) {
    return gate("no_permission");
  }
  if (input.isSubmitting) {
    return gate("already_resolving");
  }
  if (
    !(input.action && conflictActions.includes(input.action as ConflictAction))
  ) {
    return gate("action_required");
  }
  if (input.reason.trim().length === 0) {
    return gate("reason_required");
  }

  // `assignedBillingCustomerId` is optional, but when it is sent it must name
  // the party the action already implies. The server enforces this; catching it
  // here keeps the refusal next to the control that caused it.
  const expected = expectedAssignee({
    action: input.action as ConflictAction,
    firstCustomerId: input.firstCustomerId,
    secondCustomerId: input.secondCustomerId,
  });
  if (
    input.assignedBillingCustomerId &&
    expected &&
    input.assignedBillingCustomerId !== expected
  ) {
    return gate("assignment_mismatch");
  }

  if (!input.acknowledged) {
    return gate("acknowledgement_required");
  }

  return { allowed: true };
}

/**
 * Which customer an action implies. `operator_split` implies none, which is why
 * it returns undefined rather than a placeholder.
 */
export function expectedAssignee(input: {
  action: ConflictAction;
  firstCustomerId?: string | undefined;
  secondCustomerId?: string | undefined;
}) {
  if (input.action === "keep_existing") {
    return input.firstCustomerId;
  }
  if (input.action === "reassign_to_candidate") {
    return input.secondCustomerId;
  }
}
