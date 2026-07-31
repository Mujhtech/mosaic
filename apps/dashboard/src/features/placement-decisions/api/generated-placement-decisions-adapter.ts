import type {
  DecisionScope,
  PlacementDecisionsAdapter,
} from "@/features/placement-decisions/api/placement-decisions-adapter";
import type {
  AttributeDefinition,
  ConditionNode,
  DecisionOutcome,
  DecisionTraceStep,
  DecisionValidation,
  PlacementDecisionDetail,
  PlacementRuleSetDraft,
  QaOverride,
  SimulationInput,
  SimulationResult,
} from "@/features/placement-decisions/types/placement-decision";
import { toContractRuleSet } from "@/features/placement-decisions/types/placement-decision-document";
import type { Client } from "@/generated/api/client";
import {
  archivePlacementAttribute,
  archivePlacementRuleSet,
  archivePlacementWithUsageCheck,
  createPlacementAlias,
  createPlacementAttribute,
  createPlacementQaOverride,
  createPlacementRuleSet,
  getPlacementBinding,
  getPlacementDecision,
  getPlacementUsage,
  listEnvironments,
  listPaywallVersions,
  listPlacementAliases,
  listPlacementAttributes,
  listPlacementQaOverrides,
  listPlacementRuleSetVersions,
  listPlacements,
  publishPlacementRuleSet,
  revokePlacementQaOverride,
  simulatePlacementDecision,
  updatePlacement,
  updatePlacementRuleSetDraft,
  validatePlacementRuleSet,
} from "@/generated/api/sdk.gen";
import type {
  QaOverride as GeneratedQaOverride,
  PlacementAttribute,
  PlacementOutcome,
  PlacementRuleSetDraftResource,
  PlacementSimulationResult,
  PlacementValidation,
} from "@/generated/api/types.gen";
import { ApiError } from "@/lib/api/errors";
import { generatedDashboardClient } from "@/lib/api/generated-dashboard-client";
import type {
  MosaicPlacementDecisionV1,
  MosaicPlacementDecisionV1ConditionNode,
  MosaicPlacementDecisionV1Outcome,
  MosaicPlacementDecisionV1RuleSet,
} from "../../../../../../protocol/browser/generated/contract-types.js";

function outcome(
  value: MosaicPlacementDecisionV1Outcome | PlacementOutcome
): DecisionOutcome {
  switch (value.type) {
    case "paywall":
      return {
        paywallVersionId: value.paywallVersionId ?? "",
        type: "paywall",
        ...(value.unavailableFallbackKey
          ? { unavailableFallbackKey: value.unavailableFallbackKey }
          : {}),
      };
    case "fallback":
      return {
        fallbackKey: "key" in value ? (value.key ?? "") : "",
        type: "fallback",
      };
    case "no_paywall":
      return { type: "no_paywall" };
    case "unavailable":
      return {
        reason: (value.reason ?? "no_safe_decision") as Extract<
          DecisionOutcome,
          { type: "unavailable" }
        >["reason"],
        type: "unavailable",
      };
  }
}

function sourceReference(source: Record<string, unknown>) {
  for (const key of ["key", "productId", "capability"] as const) {
    if (typeof source[key] === "string") {
      return source[key];
    }
  }
}

function condition(
  node: MosaicPlacementDecisionV1ConditionNode,
  path: string
): ConditionNode {
  if (node.type === "condition") {
    return {
      id: path,
      kind: "condition",
      operator: node.operator,
      referenceKey: sourceReference(node.source),
      source: node.source.kind,
      value: node.operand?.value,
    };
  }
  if (node.type === "not") {
    return {
      children: [condition(node.child, `${path}.child`)],
      id: path,
      kind: "not",
    };
  }
  return {
    children: node.children.map((child, index) =>
      condition(child, `${path}.children.${index}`)
    ),
    id: path,
    kind: node.type,
  };
}

function validation(value: PlacementValidation): DecisionValidation {
  return {
    valid: value.valid,
    issues: value.issues.map((issue) => ({
      code: issue.code,
      conditionId: issue.conditionPath,
      message:
        issue.code === "duplicate_leaf_condition"
          ? "This condition duplicates another condition in the same Rule."
          : issue.code === "rule_shadowed_by_earlier_equivalent"
            ? "An earlier enabled Rule has the same conditions and will always win first."
            : issue.recoveryAction.replaceAll("_", " "),
      recoveryLabel: "Resolve",
      resourceId: issue.resourceId,
      resourceType: issue.resourceType,
      ruleId: issue.ruleId,
      severity: issue.severity,
    })),
  };
}

function draft(resource: PlacementRuleSetDraftResource): PlacementRuleSetDraft {
  const document = resource.document as unknown as MosaicPlacementDecisionV1;
  const ruleSet = document.ruleSet;
  return {
    assignmentPolicy: ruleSet.assignmentPolicy,
    defaultOutcome: outcome(ruleSet.defaultOutcome),
    environmentId: resource.ruleSet.environmentId,
    fallbacks: ruleSet.fallbacks.map((fallback) => ({
      key: fallback.key,
      outcome: outcome(fallback.outcome),
    })),
    id: resource.draft.id,
    placementId: resource.ruleSet.placementId,
    revision: resource.draft.revision,
    rules: ruleSet.rules.map((rule) => ({
      conditions: condition(rule.conditions, "condition") as Extract<
        ConditionNode,
        { children: unknown }
      >,
      enabled: rule.enabled,
      id: rule.id,
      name: rule.safeLabel ?? `Rule ${rule.priority}`,
      outcome: outcome(rule.outcome),
      priority: rule.priority,
      ...(rule.rollout
        ? {
            rollout: {
              thresholdBasisPoints: rule.rollout.thresholdBasisPoints,
            },
          }
        : {}),
    })),
    ruleSetId: resource.ruleSet.id,
    updatedAt: resource.draft.updatedAt,
    validation: validation(resource.validation),
  };
}

function attribute(value: PlacementAttribute): AttributeDefinition {
  return {
    allowedOperators:
      value.allowedOperators as AttributeDefinition["allowedOperators"],
    description: value.description || undefined,
    id: value.id,
    key: value.key,
    revision: value.revision,
    sensitivity: value.sensitivity,
    status: value.status,
    type: value.type,
    usageCount: 0,
  };
}

function qaOverride(value: GeneratedQaOverride): QaOverride {
  return {
    createdAt: value.createdAt,
    createdBy: value.createdByActorId,
    environmentId: value.environmentId,
    expiresAt: value.expiresAt,
    id: value.id,
    identityType: "installation",
    label: value.safeLabel,
    outcome: outcome(value.outcome),
    placementId: value.placementId,
    status: value.status,
  };
}

function trace(
  result: PlacementSimulationResult
): readonly DecisionTraceStep[] {
  return result.trace.map((raw, index) => {
    const resultValue = raw.result;
    const kind = typeof raw.kind === "string" ? raw.kind : "decision";
    return {
      conditionId:
        typeof raw.conditionPath === "string" ? raw.conditionPath : undefined,
      detail:
        raw.redacted === true
          ? "Sensitive value redacted"
          : [raw.operator, raw.outcomeType, raw.reasonCode]
              .filter(Boolean)
              .join(" · ") || kind,
      id: `trace-${index}`,
      label: kind.replaceAll("_", " "),
      result:
        resultValue === "true" ||
        resultValue === "false" ||
        resultValue === "unknown"
          ? resultValue
          : kind === "final"
            ? "selected"
            : "skipped",
      ruleId: typeof raw.ruleId === "string" ? raw.ruleId : undefined,
      sensitive: raw.redacted === true,
      source:
        typeof raw.inputSource === "string"
          ? raw.inputSource
          : typeof raw.source === "string"
            ? raw.source
            : undefined,
    };
  });
}

function inputValue(value: unknown, source: string, sensitive = false) {
  return {
    sensitive,
    source,
    valid: value !== undefined && value !== null,
    value,
  };
}

async function ruleSetDocument(
  client: Client,
  scope: DecisionScope,
  value: PlacementRuleSetDraft
) {
  const [attributesResult, environmentsResult, placementsResult] =
    await Promise.all([
      listPlacementAttributes({
        client,
        path: { projectId: scope.projectId },
        throwOnError: true,
      }),
      listEnvironments({
        client,
        path: { projectId: scope.projectId },
        throwOnError: true,
      }),
      listPlacements({
        client,
        path: { projectId: scope.projectId },
        throwOnError: true,
      }),
    ]);
  const environment = environmentsResult.data.data.items.find(
    (item) => item.id === scope.environmentId
  );
  const placement = placementsResult.data.data.items.find(
    (item) => item.id === scope.placementId
  );
  if (!(environment && placement)) {
    throw new Error("The Placement or Environment is unavailable.");
  }
  return {
    placementDecisionVersion: "1" as const,
    ruleSet: toContractRuleSet(value, {
      attributes: attributesResult.data.data.items.map(attribute),
      environmentKey: environment.key,
      placementKey: placement.key,
      projectId: scope.projectId,
    }),
  };
}

async function initialDocument(client: Client, scope: DecisionScope) {
  const [attributesResult, environmentsResult, placementsResult] =
    await Promise.all([
      listPlacementAttributes({
        client,
        path: { projectId: scope.projectId },
        throwOnError: true,
      }),
      listEnvironments({
        client,
        path: { projectId: scope.projectId },
        throwOnError: true,
      }),
      listPlacements({
        client,
        path: { projectId: scope.projectId },
        throwOnError: true,
      }),
    ]);
  const environment = environmentsResult.data.data.items.find(
    (item) => item.id === scope.environmentId
  );
  const placement = placementsResult.data.data.items.find(
    (item) => item.id === scope.placementId
  );
  if (!(environment && placement)) {
    throw new Error("The Placement or Environment is unavailable.");
  }
  let defaultOutcome: MosaicPlacementDecisionV1Outcome = {
    reason: "no_safe_decision",
    type: "unavailable",
  };
  try {
    const binding = await getPlacementBinding({
      client,
      path: scope,
      throwOnError: true,
    });
    const versions = await listPaywallVersions({
      client,
      path: {
        paywallId: binding.data.data.paywallId,
        projectId: scope.projectId,
      },
      throwOnError: true,
    });
    const latest = versions.data.data.items
      .filter((version) => version.environmentId === scope.environmentId)
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];
    if (latest) {
      defaultOutcome = { paywallVersionId: latest.id, type: "paywall" };
    }
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
  }
  const ruleSet: MosaicPlacementDecisionV1RuleSet = {
    assignmentPolicy: "installation",
    attributeDefinitions: attributesResult.data.data.items
      .filter((item) => item.status === "active")
      .map((item) => ({
        allowedOperators:
          item.allowedOperators as MosaicPlacementDecisionV1RuleSet["attributeDefinitions"][number]["allowedOperators"],
        key: item.key,
        sensitivity: item.sensitivity,
        type: item.type,
      })),
    compatibility: { bucketingAlgorithms: [], requiredFeatures: [] },
    defaultOutcome,
    enabled: true,
    environmentId: scope.environmentId,
    environmentKey: environment.key,
    fallbacks: [],
    id: "pending-rule-set",
    placementId: scope.placementId,
    placementKey: placement.key,
    projectId: scope.projectId,
    qaOverrides: [],
    rules: [],
    version: 1,
  };
  return { placementDecisionVersion: "1" as const, ruleSet };
}

export function createGeneratedPlacementDecisionsAdapter(
  client: Client = generatedDashboardClient
): PlacementDecisionsAdapter {
  return {
    status: "available",
    async archiveAttribute(projectId, attributeId) {
      await archivePlacementAttribute({
        client,
        path: { attributeId, projectId },
        throwOnError: true,
      });
    },
    async archivePlacement(scope) {
      await archivePlacementWithUsageCheck({
        client,
        path: scope,
        throwOnError: true,
      });
    },
    async archiveRuleSet(scope, ruleSetId) {
      await archivePlacementRuleSet({
        client,
        path: { ...scope, ruleSetId },
        throwOnError: true,
      });
    },
    async createAlias(scope, key) {
      const result = await createPlacementAlias({
        body: { key },
        client,
        path: scope,
        throwOnError: true,
      });
      return { key: result.data.data.key, status: result.data.data.status };
    },
    async createAttribute(projectId, value) {
      const result = await createPlacementAttribute({
        body: { ...value, allowedOperators: [...value.allowedOperators] },
        client,
        path: { projectId },
        throwOnError: true,
      });
      return attribute(result.data.data);
    },
    async createOverride(scope, value) {
      const result = await createPlacementQaOverride({
        body: {
          expiresAt: value.expiresAt,
          outcome: toGeneratedOutcome(value.outcome),
          safeLabel: value.label,
          selector: `${value.identityType}:${value.identityReference}`,
        },
        client,
        path: scope,
        throwOnError: true,
      });
      return {
        ...qaOverride(result.data.data.override),
        token: result.data.data.token,
      };
    },
    async getPlacementDecision(scope): Promise<PlacementDecisionDetail> {
      const [aliasesResult, usageResult, placementsResult] = await Promise.all([
        listPlacementAliases({ client, path: scope, throwOnError: true }),
        getPlacementUsage({ client, path: scope, throwOnError: true }),
        listPlacements({
          client,
          path: { projectId: scope.projectId },
          throwOnError: true,
        }),
      ]);
      const placement = placementsResult.data.data.items.find(
        (item) => item.id === scope.placementId
      );
      if (!placement) {
        throw new Error("Placement not found.");
      }
      let resource: PlacementRuleSetDraftResource;
      try {
        const result = await getPlacementDecision({
          client,
          path: scope,
          throwOnError: true,
        });
        resource = result.data.data;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) {
          throw error;
        }
        const document = await initialDocument(client, scope);
        const now = new Date().toISOString();
        resource = {
          document,
          draft: {
            createdAt: now,
            createdByActorId: "",
            environmentId: scope.environmentId,
            id: "pending-draft",
            projectId: scope.projectId,
            revision: 1,
            ruleSetId: "pending-rule-set",
            status: "active",
            updatedAt: now,
            updatedByActorId: "",
          },
          ruleSet: {
            contractVersion: "1",
            createdAt: now,
            createdByActorId: "",
            environmentId: scope.environmentId,
            id: "pending-rule-set",
            placementId: scope.placementId,
            projectId: scope.projectId,
            status: "active",
            updatedAt: now,
          },
          validation: { issues: [], valid: true },
        };
      }
      const published =
        resource.ruleSet.id === "pending-rule-set"
          ? undefined
          : await listPlacementRuleSetVersions({
              client,
              path: { ...scope, ruleSetId: resource.ruleSet.id },
              throwOnError: true,
            }).then(
              (result) =>
                [...result.data.data.items].sort(
                  (left, right) => right.versionNumber - left.versionNumber
                )[0]
            );
      return {
        aliases: aliasesResult.data.data.items.map((item) => ({
          key: item.key,
          status: item.status,
        })),
        description: placement.description,
        draft: draft(resource),
        id: placement.id,
        key: placement.key,
        name: placement.name,
        projectId: scope.projectId,
        publishedVersion: published
          ? {
              id: published.id,
              publishedAt: published.publishedAt,
              version: published.versionNumber,
            }
          : undefined,
        status: placement.status,
        usage: usageResult.data.data,
      };
    },
    async listAttributes(projectId) {
      const result = await listPlacementAttributes({
        client,
        path: { projectId },
        throwOnError: true,
      });
      return result.data.data.items.map(attribute);
    },
    async listOverrides(scope) {
      const result = await listPlacementQaOverrides({
        client,
        path: scope,
        throwOnError: true,
      });
      return result.data.data.items.map(qaOverride);
    },
    async publishRuleSet(scope, value) {
      const result = await publishPlacementRuleSet({
        body: { expectedRevision: value.revision },
        client,
        path: { ...scope, ruleSetId: value.ruleSetId },
        throwOnError: true,
      });
      return {
        id: result.data.data.id,
        publishedAt: result.data.data.publishedAt,
        version: result.data.data.versionNumber,
      };
    },
    async revokeOverride(scope, overrideId) {
      await revokePlacementQaOverride({
        client,
        path: { ...scope, overrideId },
        throwOnError: true,
      });
    },
    async saveDraft(scope, value) {
      const document = await ruleSetDocument(client, scope, value.draft);
      if (value.draft.ruleSetId === "pending-rule-set") {
        const created = await createPlacementRuleSet({
          body: { document },
          client,
          headers: { "Idempotency-Key": value.idempotencyKey },
          path: scope,
          throwOnError: true,
        });
        return draft(created.data.data);
      }
      const result = await updatePlacementRuleSetDraft({
        body: { document },
        client,
        headers: {
          "Idempotency-Key": value.idempotencyKey,
          "If-Match": `"ruleset-draft:${value.draft.id}:${value.revision}"`,
        },
        path: { ...scope, ruleSetId: value.draft.ruleSetId },
        throwOnError: true,
      });
      return draft(result.data.data);
    },
    async simulate(scope, value) {
      const detail = await getPlacementDecision({
        client,
        path: scope,
        throwOnError: true,
      });
      const result = await simulatePlacementDecision({
        body: simulationRequest(value),
        client,
        path: { ...scope, ruleSetId: detail.data.data.ruleSet.id },
        throwOnError: true,
      });
      return simulationResult(result.data.data);
    },
    async updatePlacement(scope, value) {
      const result = await updatePlacement({
        body: value,
        client,
        path: scope,
        throwOnError: true,
      });
      return {
        description: result.data.data.description,
        name: result.data.data.name,
      };
    },
    async validateDraft(scope) {
      const detail = await getPlacementDecision({
        client,
        path: scope,
        throwOnError: true,
      });
      const result = await validatePlacementRuleSet({
        client,
        path: { ...scope, ruleSetId: detail.data.data.ruleSet.id },
        throwOnError: true,
      });
      return validation(result.data.data);
    },
  };
}

function toGeneratedOutcome(value: DecisionOutcome): PlacementOutcome {
  switch (value.type) {
    case "paywall":
      return {
        paywallVersionId: value.paywallVersionId,
        type: "paywall",
        unavailableFallbackKey: value.unavailableFallbackKey,
      };
    case "fallback":
      return { key: value.fallbackKey, type: "fallback" };
    case "no_paywall":
      return { type: "no_paywall" };
    case "unavailable":
      return { reason: value.reason, type: "unavailable" };
  }
}

function simulationRequest(value: SimulationInput) {
  return {
    applicationVersion: value.applicationVersion,
    attributes: Object.fromEntries(
      Object.entries(value.attributes).map(([key, item]) => [
        key,
        inputValue(item, "host_application"),
      ])
    ),
    country: value.country,
    entitlements: Object.fromEntries(
      Object.entries(value.entitlementStates).map(([key, item]) => [
        key,
        inputValue(item, "provider"),
      ])
    ),
    installationId: value.installationId,
    locale: value.locale,
    osVersion: value.osVersion,
    overrideToken: value.overrideToken,
    platform: value.platform,
    productAvailability: Object.fromEntries(
      Object.entries(value.productAvailability).map(([key, item]) => [
        key,
        inputValue(item, "provider"),
      ])
    ),
    productReadiness: Object.fromEntries(
      Object.entries(value.productReadiness).map(([key, item]) => [
        key,
        inputValue(item, "configuration"),
      ])
    ),
    providerCapabilities: Object.fromEntries(
      value.providerCapabilities.map((key) => [
        key,
        inputValue(true, "provider"),
      ])
    ),
    userId: value.userId,
  };
}

function simulationResult(value: PlacementSimulationResult): SimulationResult {
  return {
    assignmentKeyType:
      value.assignmentKeyType as SimulationResult["assignmentKeyType"],
    fallbackPath: value.fallbackPath,
    finalOutcome: outcome(value.finalOutcome),
    rolloutBucket: value.rolloutBucket,
    trace: trace(value),
    winningRuleId: value.winningRuleId,
  };
}

export const generatedPlacementDecisionsAdapter =
  createGeneratedPlacementDecisionsAdapter();
