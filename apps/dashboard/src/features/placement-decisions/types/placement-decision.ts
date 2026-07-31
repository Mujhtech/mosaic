export type AssignmentPolicy =
  "installation" | "identified_user" | "identified_user_or_installation"

export type DecisionOutcome =
  | { type: "paywall"; paywallVersionId: string; unavailableFallbackKey?: string }
  | { type: "no_paywall" }
  | { type: "fallback"; fallbackKey: string }
  | {
      type: "unavailable"
      reason:
        | "no_safe_decision"
        | "configuration_incompatible"
        | "content_unavailable"
        | "commerce_unavailable"
    }

export type ConditionGroupKind = "all" | "any" | "not"

export type ConditionSource =
  | "device.platform"
  | "device.os_version"
  | "application.version"
  | "application.locale"
  | "context.country"
  | "environment.id"
  | "environment.key"
  | "identity.user_present"
  | "user_attribute"
  | "entitlement_state"
  | "product_availability"
  | "product_readiness"
  | "provider_capability"

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "exists"
  | "does_not_exist"
  | "contains_any"
  | "contains_all"
  | "locale_matches"

export interface LeafCondition {
  id: string
  kind: "condition"
  source: ConditionSource
  operator: ConditionOperator
  referenceKey?: string
  value?: string | number | boolean | readonly string[]
}

export interface ConditionGroup {
  id: string
  kind: ConditionGroupKind
  children: readonly ConditionNode[]
}

export type ConditionNode = LeafCondition | ConditionGroup

export interface PlacementRule {
  id: string
  name: string
  enabled: boolean
  priority: number
  conditions: ConditionGroup
  rollout?: { thresholdBasisPoints: number }
  outcome: DecisionOutcome
}

export interface NamedFallback {
  key: string
  outcome: DecisionOutcome
}

export interface PlacementRuleSetDraft {
  id: string
  revision: number
  ruleSetId: string
  placementId: string
  environmentId: string
  assignmentPolicy: AssignmentPolicy
  defaultOutcome: DecisionOutcome
  fallbacks: readonly NamedFallback[]
  rules: readonly PlacementRule[]
  updatedAt: string
  validation?: DecisionValidation
}

export interface PlacementDecisionDetail {
  id: string
  projectId: string
  key: string
  name: string
  description?: string
  status: "active" | "archived"
  aliases: readonly { key: string; status: "active" | "archived" }[]
  usage: { aliasCount: number; publishedRuleCount: number; ruleSetCount: number }
  draft: PlacementRuleSetDraft
  publishedVersion?: { id: string; version: number; publishedAt: string }
}

export interface DecisionValidationIssue {
  code: string
  message: string
  severity: "error" | "warning"
  ruleId?: string
  conditionId?: string
  resourceId?: string
  resourceType?: string
  recoveryHref?: string
  recoveryLabel?: string
}

export interface DecisionValidation {
  issues: readonly DecisionValidationIssue[]
  valid: boolean
}

export type AttributeType =
  "string" | "boolean" | "number" | "timestamp" | "semantic_version" | "string_list"

export interface AttributeDefinition {
  id: string
  key: string
  type: AttributeType
  description?: string
  allowedOperators: readonly ConditionOperator[]
  sensitivity: "standard" | "sensitive"
  status: "active" | "archived"
  revision: number
  usageCount: number
}

export interface QaOverride {
  id: string
  label: string
  placementId: string
  environmentId: string
  identityType: "installation" | "identified_user"
  outcome: DecisionOutcome
  expiresAt: string
  status: "active" | "revoked" | "expired"
  createdAt: string
  createdBy?: string
}

export interface SimulationInput {
  platform?: "ios" | "android"
  osVersion?: string
  applicationVersion?: string
  locale?: string
  country?: string
  installationId?: string
  userId?: string
  attributes: Readonly<Record<string, string | number | boolean | readonly string[]>>
  entitlementStates: Readonly<
    Record<string, "active" | "inactive" | "unknown" | "provider_unavailable" | "failed">
  >
  productAvailability: Readonly<Record<string, "available" | "unavailable" | "unknown">>
  productReadiness: Readonly<Record<string, "ready" | "not_ready" | "unknown">>
  providerCapabilities: readonly string[]
  overrideToken?: string
}

export interface DecisionTraceStep {
  id: string
  ruleId?: string
  conditionId?: string
  label: string
  detail: string
  result: "true" | "false" | "unknown" | "selected" | "skipped"
  source?: string
  sensitive?: boolean
}

export interface SimulationResult {
  finalOutcome: DecisionOutcome
  winningRuleId?: string
  assignmentKeyType?: AssignmentPolicy
  rolloutBucket?: number
  fallbackPath: readonly string[]
  productReadiness?: "ready" | "not_ready" | "unknown"
  trace: readonly DecisionTraceStep[]
}

export type EnvironmentKind = "development" | "staging" | "production"
