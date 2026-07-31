/**
 * Reconciliation window rules.
 *
 * A reconciliation run walks store history. An unbounded, inverted, or future
 * window either floods ingestion or silently examines nothing, so the window is
 * validated before submission rather than being discovered as a 422.
 *
 * The 180-day ceiling is the contract's own limit (it matches Apple's
 * notification-history retention). The API does not publish a machine-readable
 * limits payload, so the value is named here and cited rather than duplicated
 * as a bare number at a call site.
 */

export const MAX_RECONCILIATION_WINDOW_DAYS = 180

const DAY_MS = 24 * 60 * 60 * 1000
/** Tolerates clock skew between the operator's browser and the API. */
const FUTURE_SKEW_MS = 5 * 60 * 1000

export type ReconciliationRangeIssue =
  | "end_in_future"
  | "end_required"
  | "invalid_timestamp"
  | "start_not_before_end"
  | "start_required"
  | "window_too_long"

const ISSUE_MESSAGES: Record<ReconciliationRangeIssue, string> = {
  end_in_future: "The window must end now or in the past. Stores have no history to reconcile yet.",
  end_required: "Choose when the reconciliation window ends.",
  invalid_timestamp: "Enter both bounds as complete dates and times.",
  start_not_before_end: "The window must start before it ends.",
  start_required: "Choose when the reconciliation window starts.",
  window_too_long: `A reconciliation window may not exceed ${MAX_RECONCILIATION_WINDOW_DAYS} days, which is the store's own notification-history retention. Run consecutive windows instead.`,
}

export function describeReconciliationRangeIssue(issue: ReconciliationRangeIssue) {
  return ISSUE_MESSAGES[issue]
}

export interface ReconciliationRangeInput {
  now?: Date
  windowEnd: string
  windowStart: string
}

export function validateReconciliationRange(
  input: ReconciliationRangeInput,
): readonly ReconciliationRangeIssue[] {
  const issues: ReconciliationRangeIssue[] = []
  if (!input.windowStart) issues.push("start_required")
  if (!input.windowEnd) issues.push("end_required")
  if (issues.length > 0) return issues

  const start = Date.parse(input.windowStart)
  const end = Date.parse(input.windowEnd)
  if (Number.isNaN(start) || Number.isNaN(end)) return ["invalid_timestamp"]

  if (start >= end) issues.push("start_not_before_end")
  if (end - start > MAX_RECONCILIATION_WINDOW_DAYS * DAY_MS) issues.push("window_too_long")
  if (end > (input.now?.getTime() ?? Date.now()) + FUTURE_SKEW_MS) issues.push("end_in_future")

  return issues
}

/** Converts a `datetime-local` control value to the UTC instant the API takes. */
export function toIsoInstant(localValue: string) {
  const parsed = Date.parse(localValue)
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString()
}

/** A safe starting window: the last 7 days, well inside the ceiling. */
export function defaultReconciliationWindow(now = new Date()) {
  const end = new Date(now.getTime())
  const start = new Date(now.getTime() - 7 * DAY_MS)
  return { windowEnd: toLocalInputValue(end), windowStart: toLocalInputValue(start) }
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
