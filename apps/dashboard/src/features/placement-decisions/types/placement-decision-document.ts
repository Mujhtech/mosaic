import type {
  AttributeDefinition,
  ConditionNode,
  DecisionOutcome,
  LeafCondition,
  PlacementRuleSetDraft,
} from "@/features/placement-decisions/types/placement-decision";
import type {
  MosaicPlacementDecisionV1ConditionNode,
  MosaicPlacementDecisionV1Outcome,
  MosaicPlacementDecisionV1RuleSet,
  MosaicPlacementDecisionV1Source,
  MosaicPlacementDecisionV1TypedValue,
} from "../../../../../../protocol/browser/generated/contract-types.js";

function source(
  conditionValue: LeafCondition
): MosaicPlacementDecisionV1Source {
  if (
    conditionValue.source === "user_attribute" ||
    conditionValue.source === "entitlement_state"
  ) {
    return {
      kind: conditionValue.source,
      key: conditionValue.referenceKey ?? "",
    };
  }
  if (
    conditionValue.source === "product_availability" ||
    conditionValue.source === "product_readiness"
  ) {
    return {
      kind: conditionValue.source,
      productId: conditionValue.referenceKey ?? "",
    };
  }
  if (conditionValue.source === "provider_capability") {
    return {
      capability: (conditionValue.referenceKey ?? "product_loading") as
        | "product_loading"
        | "purchase"
        | "restore"
        | "entitlement_lookup",
      kind: conditionValue.source,
    };
  }
  return { kind: conditionValue.source };
}

function operand(
  conditionValue: LeafCondition,
  attributes: ReadonlyMap<string, AttributeDefinition>
): MosaicPlacementDecisionV1TypedValue | undefined {
  if (
    conditionValue.operator === "exists" ||
    conditionValue.operator === "does_not_exist"
  ) {
    return;
  }
  const value = conditionValue.value ?? "";
  const attributeType =
    conditionValue.source === "user_attribute"
      ? attributes.get(conditionValue.referenceKey ?? "")?.type
      : undefined;
  if (attributeType === "boolean" || typeof value === "boolean") {
    return {
      type: "boolean",
      value: typeof value === "boolean" ? value : value === "true",
    };
  }
  if (attributeType === "number" || typeof value === "number") {
    return {
      type: "number",
      value: typeof value === "number" ? value : Number(value),
    };
  }
  if (attributeType === "timestamp") {
    return { type: "timestamp", value: String(value) };
  }
  if (
    attributeType === "semantic_version" ||
    conditionValue.source.endsWith("version")
  ) {
    return { type: "semantic_version", value: String(value) };
  }
  if (attributeType === "string_list" || Array.isArray(value)) {
    return {
      type: "string_list",
      value: Array.isArray(value) ? [...value] : [String(value)],
    };
  }
  return { type: "string", value: String(value) };
}

function condition(
  node: ConditionNode,
  attributes: ReadonlyMap<string, AttributeDefinition>
): MosaicPlacementDecisionV1ConditionNode {
  if (node.kind === "condition") {
    const value = operand(node, attributes);
    return {
      operator: node.operator,
      ...(value ? { operand: value } : {}),
      source: source(node),
      type: "condition",
    };
  }
  if (node.kind === "not") {
    const [child] = node.children;
    if (!child) {
      throw new Error("Not requires one condition.");
    }
    return { child: condition(child, attributes), type: "not" };
  }
  return {
    children: node.children.map((child) => condition(child, attributes)),
    type: node.kind,
  };
}

export function toContractOutcome(
  outcome: DecisionOutcome
): MosaicPlacementDecisionV1Outcome {
  switch (outcome.type) {
    case "paywall":
      return {
        paywallVersionId: outcome.paywallVersionId,
        type: "paywall",
        ...(outcome.unavailableFallbackKey
          ? { unavailableFallbackKey: outcome.unavailableFallbackKey }
          : {}),
      };
    case "fallback":
      return { key: outcome.fallbackKey, type: "fallback" };
    case "no_paywall":
      return { type: "no_paywall" };
    case "unavailable":
      return { reason: outcome.reason, type: "unavailable" };
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unhandled outcome.type: ${JSON.stringify(unhandled)}`);
    }
  }
}

export function toContractRuleSet(
  draft: PlacementRuleSetDraft,
  input: {
    attributes: readonly AttributeDefinition[];
    environmentKey: string;
    placementKey: string;
    projectId: string;
  }
): MosaicPlacementDecisionV1RuleSet {
  const attributes = new Map(
    input.attributes.map((attribute) => [attribute.key, attribute])
  );
  return {
    assignmentPolicy: draft.assignmentPolicy,
    attributeDefinitions: input.attributes
      .filter((attribute) => attribute.status === "active")
      .map((attribute) => ({
        allowedOperators: [...attribute.allowedOperators].filter(
          (operator) => operator !== "locale_matches"
        ) as MosaicPlacementDecisionV1RuleSet["attributeDefinitions"][number]["allowedOperators"],
        key: attribute.key,
        sensitivity: attribute.sensitivity,
        type: attribute.type,
      })),
    compatibility: {
      bucketingAlgorithms: draft.rules.some((rule) => rule.rollout)
        ? ["sha256_length_prefixed_v1"]
        : [],
      requiredFeatures: [],
    },
    defaultOutcome: toContractOutcome(draft.defaultOutcome),
    enabled: true,
    environmentId: draft.environmentId,
    environmentKey: input.environmentKey,
    fallbacks: draft.fallbacks.map((fallback) => ({
      key: fallback.key,
      outcome: toContractOutcome(fallback.outcome),
      safeLabel: fallback.key,
    })),
    id: draft.ruleSetId,
    placementId: draft.placementId,
    placementKey: input.placementKey,
    projectId: input.projectId,
    qaOverrides: [],
    rules: [...draft.rules]
      .sort((left, right) => left.priority - right.priority)
      .map((rule) => ({
        conditions: condition(rule.conditions, attributes),
        enabled: rule.enabled,
        id: rule.id,
        outcome: toContractOutcome(rule.outcome),
        priority: rule.priority,
        ...(rule.rollout
          ? {
              rollout: {
                algorithm: "sha256_length_prefixed_v1" as const,
                thresholdBasisPoints: rule.rollout.thresholdBasisPoints,
              },
            }
          : {}),
        safeLabel: rule.name,
      })),
    version: draft.revision,
  };
}
