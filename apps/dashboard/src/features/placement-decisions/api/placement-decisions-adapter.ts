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
} from "@/features/placement-decisions/types/placement-decision"

export interface DecisionScope {
  environmentId: string
  placementId: string
  projectId: string
}

export interface PlacementDecisionsAdapter {
  readonly status: "available" | "contract_pending"
  getPlacementDecision(scope: DecisionScope): Promise<PlacementDecisionDetail>
  updatePlacement(
    scope: DecisionScope,
    input: { description?: string; name: string },
  ): Promise<{ description?: string; name: string }>
  createAlias(
    scope: DecisionScope,
    key: string,
  ): Promise<{ key: string; status: "active" | "archived" }>
  archivePlacement(scope: DecisionScope): Promise<void>
  archiveRuleSet(scope: DecisionScope, ruleSetId: string): Promise<void>
  saveDraft(
    scope: DecisionScope,
    input: { draft: PlacementRuleSetDraft; idempotencyKey: string; revision: number },
  ): Promise<PlacementRuleSetDraft>
  validateDraft(scope: DecisionScope, revision: number): Promise<DecisionValidation>
  publishRuleSet(
    scope: DecisionScope,
    input: { revision: number; ruleSetId: string },
  ): Promise<{ id: string; publishedAt: string; version: number }>
  simulate(scope: DecisionScope, input: SimulationInput): Promise<SimulationResult>
  listAttributes(projectId: string): Promise<readonly AttributeDefinition[]>
  createAttribute(
    projectId: string,
    input: Omit<AttributeDefinition, "id" | "revision" | "status" | "usageCount">,
  ): Promise<AttributeDefinition>
  archiveAttribute(projectId: string, attributeId: string): Promise<void>
  listOverrides(scope: DecisionScope): Promise<readonly QaOverride[]>
  createOverride(
    scope: DecisionScope,
    input: {
      environmentKind: EnvironmentKind
      expiresAt: string
      identityReference: string
      identityType: QaOverride["identityType"]
      label: string
      outcome: DecisionOutcome
    },
  ): Promise<QaOverride & { token?: string }>
  revokeOverride(scope: DecisionScope, overrideId: string): Promise<void>
}

export class PlacementDecisionContractPendingError extends Error {
  constructor() {
    super(
      "Advanced Placement decisions are unavailable while the REST contract is being generated.",
    )
    this.name = "PlacementDecisionContractPendingError"
  }
}

const pending = () => Promise.reject(new PlacementDecisionContractPendingError())

export const CONTRACT_PENDING_PLACEMENT_DECISIONS_ADAPTER: PlacementDecisionsAdapter = {
  status: "contract_pending",
  archiveAttribute: pending,
  archivePlacement: pending,
  archiveRuleSet: pending,
  createAlias: pending,
  createAttribute: pending,
  createOverride: pending,
  getPlacementDecision: pending,
  listAttributes: pending,
  listOverrides: pending,
  publishRuleSet: pending,
  revokeOverride: pending,
  saveDraft: pending,
  simulate: pending,
  updatePlacement: pending,
  validateDraft: pending,
}
