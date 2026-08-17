import type {
  AttributeDefinition,
  DecisionOutcome,
  DecisionValidation,
  EnvironmentKind,
  PlacementDecisionDetail,
  PlacementRuleSetDraft,
  QaOverride,
  SimulationInput,
  SimulationResult,
} from "@/features/placement-decisions/types/placement-decision";

export interface DecisionScope {
  environmentId: string;
  placementId: string;
  projectId: string;
}

export interface PlacementDecisionsAdapter {
  archiveAttribute: (projectId: string, attributeId: string) => Promise<void>;
  archivePlacement: (scope: DecisionScope) => Promise<void>;
  archiveRuleSet: (scope: DecisionScope, ruleSetId: string) => Promise<void>;
  createAlias: (
    scope: DecisionScope,
    key: string
  ) => Promise<{ key: string; status: "active" | "archived" }>;
  createAttribute: (
    projectId: string,
    input: Omit<
      AttributeDefinition,
      "id" | "revision" | "status" | "usageCount"
    >
  ) => Promise<AttributeDefinition>;
  createOverride: (
    scope: DecisionScope,
    input: {
      environmentKind: EnvironmentKind;
      expiresAt: string;
      identityReference: string;
      identityType: QaOverride["identityType"];
      label: string;
      outcome: DecisionOutcome;
    }
  ) => Promise<QaOverride & { token?: string }>;
  getPlacementDecision: (
    scope: DecisionScope
  ) => Promise<PlacementDecisionDetail>;
  listAttributes: (
    projectId: string
  ) => Promise<readonly AttributeDefinition[]>;
  listOverrides: (scope: DecisionScope) => Promise<readonly QaOverride[]>;
  publishRuleSet: (
    scope: DecisionScope,
    input: { revision: number; ruleSetId: string }
  ) => Promise<{ id: string; publishedAt: string; version: number }>;
  revokeOverride: (scope: DecisionScope, overrideId: string) => Promise<void>;
  saveDraft: (
    scope: DecisionScope,
    input: {
      draft: PlacementRuleSetDraft;
      idempotencyKey: string;
      revision: number;
    }
  ) => Promise<PlacementRuleSetDraft>;
  simulate: (
    scope: DecisionScope,
    input: SimulationInput
  ) => Promise<SimulationResult>;
  readonly status: "available" | "contract_pending";
  updatePlacement: (
    scope: DecisionScope,
    input: { description?: string; name: string }
  ) => Promise<{ description?: string; name: string }>;
  validateDraft: (
    scope: DecisionScope,
    revision: number
  ) => Promise<DecisionValidation>;
}
