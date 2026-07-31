export type ExperimentStatus =
  "draft" | "scheduled" | "running" | "paused" | "stopped" | "completed" | "archived"

export type AssignmentKeyPolicy =
  "installation" | "identified_user" | "identified_user_or_installation"

export type ExperimentRole = "control" | "treatment"

export interface ExperimentScope {
  environmentId: string
  projectId: string
}

export interface ExperimentVariantDraft {
  allocationBasisPoints: number
  id?: string
  name: string
  paywallId: string
  paywallVersionId: string
  role: ExperimentRole
}

export interface ExperimentDraftDocument {
  assignmentKeyPolicy: AssignmentKeyPolicy
  endsAt?: string
  guardrailMetricVersionIds: readonly string[]
  hypothesis?: string
  mutualExclusionGroupVersionId?: string
  primaryMetricVersionId: string
  qaEnabled?: boolean
  startsAt: string
  variants: readonly ExperimentVariantDraft[]
}

export interface ExperimentDraft extends ExperimentDraftDocument {
  id: string
  revision: number
  updatedAt: string
}

export interface ExperimentListItem {
  activeVersionId?: string
  activeVersionNumber?: number
  id: string
  name: string
  placementId: string
  placementName: string
  status: ExperimentStatus
  updatedAt: string
}

export interface ExperimentDetail extends ExperimentListItem {
  activeDefinition?: ExperimentActiveDefinition
  activeVariants?: readonly ExperimentVariantDraft[]
  activeVersionId?: string
  currentDraft?: ExperimentDraft
  hypothesis?: string
}

export interface ExperimentActiveDefinition extends ExperimentDraftDocument {
  allocationVersion: string
  bucketingAlgorithm: string
  publishedAt: string
  qaPolicyEnabled?: boolean
  sourceRevision: number
}

export interface ImmutablePaywallVersionOption {
  createdAt: string
  id: string
  paywallId: string
  paywallName: string
  versionNumber: number
}

export interface MetricDefinitionOption {
  assignmentUnit: "assignment_key"
  authority: "client_observed" | "provider_confirmed"
  availability: "available" | "trusted_source_unavailable"
  definition: string
  eligibleAsGuardrail: boolean
  eligibleAsPrimary: boolean
  eventFilter: { "payload.reason"?: "provider_unavailable" }
  id: string
  name: string
  versionId: string
}

export interface MutualExclusionGroupOption {
  assignmentKeyPolicy?: AssignmentKeyPolicy
  holdoutBasisPoints?: number
  id: string
  members?: readonly { allocationBasisPoints: number; experimentId: string }[]
  name: string
  versionId: string
}

export interface CreateMutualExclusionGroupInput {
  assignmentKeyPolicy: AssignmentKeyPolicy
  holdoutBasisPoints: number
  members: readonly { allocationBasisPoints: number; experimentId: string }[]
  name: string
}

export interface MutualExclusionGroupVersion {
  assignmentKeyPolicy: AssignmentKeyPolicy
  createdAt: string
  groupId: string
  holdoutBasisPoints: number
  id: string
  members: readonly { allocationBasisPoints: number; experimentId: string }[]
  versionNumber: number
}

export type ExperimentIssueSeverity = "info" | "warning" | "critical" | "error"

export interface ExperimentIssue {
  affectedResources?: readonly string[]
  code: string
  continues: boolean
  investigation?: string
  message: string
  recoveryAction?: string
  severity: ExperimentIssueSeverity
  title: string
}

export interface ExperimentValidation {
  canPublish: boolean
  issues: readonly ExperimentIssue[]
}

export interface Interval {
  high: number
  low: number
}

export interface VariantResult {
  allocationBasisPoints: number
  conversions: number
  estimate: number
  interval: Interval
  name: string
  role: ExperimentRole
  uniqueExposures: number
  variantId: string
}

export interface TreatmentLift {
  absoluteLift: number
  interval: Interval
  relativeLift?: number
  variantId: string
}

export interface GuardrailResult {
  code?: string
  estimate?: number
  investigation?: string
  name: string
  recoveryAction?: string
  severity: "ok" | "warning" | "critical" | "unavailable"
  summary: string
}

export interface ExperimentResults {
  aggregateUpdatedAt?: string
  attributionWindowMature: boolean
  fallbackExposures: number
  freshnessMinutes?: number
  guardrails: readonly GuardrailResult[]
  interim: boolean
  issues: readonly ExperimentIssue[]
  observationEndsAt?: string
  observationStartsAt?: string
  primaryMetricName: string
  primaryMetricAuthority: "client_observed" | "provider_confirmed"
  primaryMetricAvailability: "available" | "trusted_source_unavailable"
  primaryMetricEventFilter: { "payload.reason"?: "provider_unavailable" }
  srm: {
    cells: readonly {
      expected: number
      expectedShare: number
      observed: number
      observedShare: number
      variantId: string
    }[]
    degreesOfFreedom: number
    exclusions: readonly string[]
    pValue: number
    severity: "none" | "warning" | "critical"
    statistic: number
    status: "insufficient_sample" | "ok" | "mismatch"
  }
  treatments: readonly TreatmentLift[]
  variants: readonly VariantResult[]
}

export interface ExperimentHistoryEntry {
  actorLabel?: string
  createdAt: string
  id: string
  reason?: string
  releaseId?: string
  summary: string
}

export interface QaOverride {
  expiresAt: string
  id: string
  identityType: "installation" | "identified_user"
  label: string
  variantId: string
  visibleSelectorDigest: string
}

export interface QaOverrideCreated {
  override: QaOverride
  token: string
}

export interface ExperimentExportJob {
  expiresAt?: string
  id: string
  identityScoped: boolean
  status: "queued" | "running" | "completed" | "failed" | "expired"
}

export function allocationTotal(variants: readonly ExperimentVariantDraft[]) {
  return variants.reduce((total, variant) => total + variant.allocationBasisPoints, 0)
}

export function canSelectMetric(metric: MetricDefinitionOption) {
  return metric.availability === "available"
}

export function describeMetricEventFilter(filter: MetricDefinitionOption["eventFilter"]) {
  return filter["payload.reason"]
    ? `payload.reason = ${filter["payload.reason"]}`
    : "All qualifying events"
}

export function localDateTimeToUtc(value?: string) {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function utcToLocalDateTime(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function validateAllocation(variants: readonly ExperimentVariantDraft[]) {
  if (variants.length < 2 || variants.length > 4) {
    return "Use exactly one Control and one to three Treatments."
  }
  if (variants.filter((variant) => variant.role === "control").length !== 1) {
    return "Choose exactly one Control."
  }
  if (variants.some((variant) => variant.allocationBasisPoints <= 0)) {
    return "Every Variant needs a positive allocation."
  }
  if (allocationTotal(variants) !== 10_000) {
    return "Traffic split must total exactly 100% (10,000 basis points)."
  }
  return undefined
}

export function validateMutualExclusionAllocation(
  members: readonly { allocationBasisPoints: number; experimentId: string }[],
  holdoutBasisPoints: number,
) {
  if (members.length < 2) return "Select at least two Experiments."
  if (new Set(members.map((member) => member.experimentId)).size !== members.length) {
    return "Each Experiment can appear only once."
  }
  if (holdoutBasisPoints < 0 || members.some((member) => member.allocationBasisPoints <= 0)) {
    return "Every group member needs a positive allocation and holdout cannot be negative."
  }
  if (
    holdoutBasisPoints + members.reduce((sum, member) => sum + member.allocationBasisPoints, 0) !==
    10_000
  ) {
    return "Experiment allocations plus normal-Placement holdout must total exactly 100% (10,000 basis points)."
  }
  return undefined
}

export function lifecycleActions(status: ExperimentStatus) {
  const actions: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
    draft: ["scheduled", "running"],
    scheduled: ["running", "stopped"],
    running: ["paused", "stopped", "completed"],
    paused: ["running", "stopped", "completed"],
    stopped: ["archived"],
    completed: ["archived"],
    archived: [],
  }
  return actions[status]
}

export function canRequestExperimentExport(
  role: "owner" | "admin" | "member" | undefined,
  identityScoped: boolean,
) {
  return identityScoped ? role === "owner" : role === "owner" || role === "admin"
}
