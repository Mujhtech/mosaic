export type AssignmentPolicy =
  | "installation"
  | "identified_user"
  | "identified_user_or_installation";

export type DecisionOutcome =
  | {
      type: "paywall";
      paywallVersionId: string;
      unavailableFallbackKey?: string;
    }
  | { type: "no_paywall" }
  | { type: "fallback"; fallbackKey: string }
  | {
      type: "unavailable";
      reason:
        | "no_safe_decision"
        | "configuration_incompatible"
        | "content_unavailable"
        | "commerce_unavailable";
    };

export type ConditionGroupKind = "all" | "any" | "not";

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
  | "provider_capability";

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
  | "locale_matches";

export interface LeafCondition {
  id: string;
  kind: "condition";
  operator: ConditionOperator;
  referenceKey?: string;
  source: ConditionSource;
  value?: string | number | boolean | readonly string[];
}

export interface ConditionGroup {
  children: readonly ConditionNode[];
  id: string;
  kind: ConditionGroupKind;
}

export type ConditionNode = LeafCondition | ConditionGroup;

export interface PlacementRule {
  conditions: ConditionGroup;
  enabled: boolean;
  id: string;
  name: string;
  outcome: DecisionOutcome;
  priority: number;
  rollout?: { thresholdBasisPoints: number };
}

export interface NamedFallback {
  key: string;
  outcome: DecisionOutcome;
}

export interface PlacementRuleSetDraft {
  assignmentPolicy: AssignmentPolicy;
  defaultOutcome: DecisionOutcome;
  environmentId: string;
  fallbacks: readonly NamedFallback[];
  id: string;
  placementId: string;
  revision: number;
  ruleSetId: string;
  rules: readonly PlacementRule[];
  updatedAt: string;
  validation?: DecisionValidation;
}

export interface PlacementDecisionDetail {
  aliases: readonly { key: string; status: "active" | "archived" }[];
  description?: string;
  draft: PlacementRuleSetDraft;
  id: string;
  key: string;
  name: string;
  projectId: string;
  publishedVersion?: { id: string; version: number; publishedAt: string };
  status: "active" | "archived";
  usage: {
    aliasCount: number;
    publishedRuleCount: number;
    ruleSetCount: number;
  };
}

export interface DecisionValidationIssue {
  code: string;
  conditionId?: string;
  message: string;
  recoveryHref?: string;
  recoveryLabel?: string;
  resourceId?: string;
  resourceType?: string;
  ruleId?: string;
  severity: "error" | "warning";
}

export interface DecisionValidation {
  issues: readonly DecisionValidationIssue[];
  valid: boolean;
}

export type AttributeType =
  | "string"
  | "boolean"
  | "number"
  | "timestamp"
  | "semantic_version"
  | "string_list";

export interface AttributeDefinition {
  allowedOperators: readonly ConditionOperator[];
  description?: string;
  id: string;
  key: string;
  revision: number;
  sensitivity: "standard" | "sensitive";
  status: "active" | "archived";
  type: AttributeType;
  usageCount: number;
}

export interface QaOverride {
  createdAt: string;
  createdBy?: string;
  environmentId: string;
  expiresAt: string;
  id: string;
  identityType: "installation" | "identified_user";
  label: string;
  outcome: DecisionOutcome;
  placementId: string;
  status: "active" | "revoked" | "expired";
}

export interface SimulationInput {
  applicationVersion?: string;
  attributes: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
  country?: string;
  entitlementStates: Readonly<
    Record<
      string,
      "active" | "inactive" | "unknown" | "provider_unavailable" | "failed"
    >
  >;
  installationId?: string;
  locale?: string;
  osVersion?: string;
  overrideToken?: string;
  platform?: "ios" | "android";
  productAvailability: Readonly<
    Record<string, "available" | "unavailable" | "unknown">
  >;
  productReadiness: Readonly<Record<string, "ready" | "not_ready" | "unknown">>;
  providerCapabilities: readonly string[];
  userId?: string;
}

export interface DecisionTraceStep {
  conditionId?: string;
  detail: string;
  id: string;
  label: string;
  result: "true" | "false" | "unknown" | "selected" | "skipped";
  ruleId?: string;
  sensitive?: boolean;
  source?: string;
}

export interface SimulationResult {
  assignmentKeyType?: AssignmentPolicy;
  fallbackPath: readonly string[];
  finalOutcome: DecisionOutcome;
  productReadiness?: "ready" | "not_ready" | "unknown";
  rolloutBucket?: number;
  trace: readonly DecisionTraceStep[];
  winningRuleId?: string;
}

export type EnvironmentKind = "development" | "staging" | "production";
