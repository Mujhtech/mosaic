import type { CreateProjectionReplayRequest, ProjectionReplayResult } from "@/generated/api"

/**
 * Vocabulary and rules for replaying a projection.
 *
 * Replay is the operational expression of "a projection is derived state": a
 * corrupt checkpoint, a promoted rule version, or a repaired Product mapping is
 * answered by recomputing, never by patching what was derived. Replayed state
 * goes through the same lock, compare-and-swap, and atomic commit as live
 * projection, and prior snapshots are never deleted.
 */

const COMPARISON_LABELS: Record<string, string> = {
  changed: "Changed",
  unchanged: "Identical",
}

const COMPARISON_EXPLANATIONS: Record<string, string> = {
  changed:
    "Recomputing produced a different state, so a new snapshot was written beside the old one. The earlier snapshot is preserved; nothing was overwritten.",
  unchanged:
    "Recomputing from the same facts produced the same checksum. Nothing was written. This is the expected outcome and it is what proves the projection is deterministic.",
}

function humanize(value: string) {
  const spaced = value.replaceAll("_", " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function replayComparisonLabel(value: string | undefined) {
  if (!value) return "Not compared"
  return COMPARISON_LABELS[value] ?? humanize(value)
}

export function replayComparisonExplanation(value: string | undefined) {
  if (!value) return "Mosaic did not report a comparison for this scope."
  return (
    COMPARISON_EXPLANATIONS[value] ??
    "Mosaic reported a comparison outcome this build does not recognise. Prior snapshots are preserved either way."
  )
}

export function replayComparisonTone(value: string | undefined) {
  return value === "changed" ? ("attention" as const) : ("neutral" as const)
}

/**
 * There is deliberately no "replay everything" member. An unbounded replay is a
 * migration, and bulk migration tooling is out of Phase 9B — so the refusal
 * lives here, before the request, rather than arriving as a 422 the operator has
 * to interpret.
 */
export type ReplayScopeIssue = "unbounded" | "window_inverted" | "window_incomplete"

const SCOPE_ISSUE_MESSAGES: Record<ReplayScopeIssue, string> = {
  unbounded:
    "A replay must be bounded. Name one Subscription Instance, one Billing Customer, or a fact window.",
  window_incomplete: "A fact window needs both a start and an end.",
  window_inverted: "The window end must be after the window start.",
}

export function validateReplayScope(
  request: CreateProjectionReplayRequest,
): ReplayScopeIssue | undefined {
  const hasInstance = Boolean(request.subscriptionInstanceId)
  const hasCustomer = Boolean(request.billingCustomerId)
  const hasStart = Boolean(request.windowStart)
  const hasEnd = Boolean(request.windowEnd)

  if (!hasInstance && !hasCustomer && !hasStart && !hasEnd) return "unbounded"
  if (!hasInstance && !hasCustomer) {
    if (!hasStart || !hasEnd) return "window_incomplete"
    if (new Date(request.windowEnd ?? "") <= new Date(request.windowStart ?? "")) {
      return "window_inverted"
    }
  }
  return undefined
}

export function describeReplayScopeIssue(issue: ReplayScopeIssue) {
  return SCOPE_ISSUE_MESSAGES[issue]
}

/**
 * The 422 an unimplemented rule version answers with.
 *
 * A checksum produced by the wrong engine is indistinguishable from a genuine
 * determinism result, so the API refuses rather than recomputing under the
 * active engine and labelling the answer with the requested number. The refusal
 * is rendered as that sentence, not as a generic validation failure.
 */
export function describeReplayRefusal(error: unknown): string | undefined {
  const status = (error as { status?: number } | undefined)?.status
  const code = (error as { code?: string } | undefined)?.code
  if (status !== 422) return undefined
  if (code === "unsupported_projection_rule_version" || code === "validation_failed") {
    return "This build does not derive under the requested projection rule version, so Mosaic refused to run the replay. Recomputing under the active engine and labelling the result with the requested number would produce a checksum indistinguishable from a genuine determinism result. Choose the active rule version, or deploy a build that implements the requested one."
  }
  return undefined
}

/**
 * Replay reports, it never promotes.
 *
 * A comparison that came back `changed` is evidence for a decision, not the
 * decision. Nothing in this feature turns a replay result into the active rule
 * version.
 */
export const NO_AUTO_PROMOTION_NOTE =
  "A replay reports what recomputing would produce. It never promotes a rule version and never becomes the active semantics on its own."

export function replaySummary(result: ProjectionReplayResult | undefined) {
  if (!result) return undefined
  const replayed = result.scopesReplayed ?? 0
  const changed = result.scopesChanged ?? 0
  if (replayed === 0) return "No scope in this Environment matched the bounds you gave."
  if (changed === 0) {
    return `${replayed} scope(s) recomputed to the same checksum. Nothing was written.`
  }
  return `${replayed} scope(s) recomputed; ${changed} produced a different state and had a new snapshot written beside the old one.`
}
