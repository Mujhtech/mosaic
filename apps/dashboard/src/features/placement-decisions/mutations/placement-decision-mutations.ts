import { mutationOptions, type QueryClient } from "@tanstack/react-query"

import type {
  DecisionScope,
  PlacementDecisionsAdapter,
} from "@/features/placement-decisions/api/placement-decisions-adapter"
import { placementDecisionKeys } from "@/features/placement-decisions/queries/placement-decision-queries"
import type {
  AttributeDefinition,
  EnvironmentKind,
  PlacementDecisionDetail,
  PlacementRuleSetDraft,
  QaOverride,
  SimulationInput,
} from "@/features/placement-decisions/types/placement-decision"

function mutationKey() {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `decision-${Date.now().toString(36)}`
}

export function saveRuleSetMutationOptions(
  scope: DecisionScope,
  adapter: PlacementDecisionsAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: (draft: PlacementRuleSetDraft) =>
      adapter.saveDraft(scope, {
        draft,
        idempotencyKey: mutationKey(),
        revision: draft.revision,
      }),
    onSuccess: (draft) => {
      queryClient.setQueryData<PlacementDecisionDetail>(
        placementDecisionKeys.detail(scope, adapter),
        (current) => (current ? { ...current, draft } : current),
      )
    },
  })
}

export function validateRuleSetMutationOptions(
  scope: DecisionScope,
  adapter: PlacementDecisionsAdapter,
) {
  return mutationOptions({
    mutationFn: (revision: number) => adapter.validateDraft(scope, revision),
  })
}

export function simulateDecisionMutationOptions(
  scope: DecisionScope,
  adapter: PlacementDecisionsAdapter,
) {
  return mutationOptions({
    gcTime: 0,
    mutationFn: (input: SimulationInput) => adapter.simulate(scope, input),
    retry: false,
  })
}

export function createAttributeMutationOptions(
  projectId: string,
  adapter: PlacementDecisionsAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: (input: Omit<AttributeDefinition, "id" | "revision" | "status" | "usageCount">) =>
      adapter.createAttribute(projectId, input),
    onSuccess: (attribute) => {
      queryClient.setQueryData<readonly AttributeDefinition[]>(
        placementDecisionKeys.attributes(projectId, adapter),
        (current) => [...(current ?? []), attribute],
      )
    },
  })
}

export function createOverrideMutationOptions(
  scope: DecisionScope,
  environmentKind: EnvironmentKind,
  adapter: PlacementDecisionsAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: (
      input: Omit<Parameters<PlacementDecisionsAdapter["createOverride"]>[1], "environmentKind">,
    ) => adapter.createOverride(scope, { ...input, environmentKind }),
    onSuccess: (override) => {
      queryClient.setQueryData<readonly QaOverride[]>(
        placementDecisionKeys.overrides(scope, adapter),
        (current) => [override, ...(current ?? [])],
      )
    },
  })
}

export function revokeOverrideMutationOptions(
  scope: DecisionScope,
  adapter: PlacementDecisionsAdapter,
  queryClient: QueryClient,
) {
  return mutationOptions({
    mutationFn: (overrideId: string) => adapter.revokeOverride(scope, overrideId),
    onSuccess: (_, overrideId) => {
      queryClient.setQueryData<readonly QaOverride[]>(
        placementDecisionKeys.overrides(scope, adapter),
        (current) =>
          current?.map((item) =>
            item.id === overrideId ? { ...item, status: "revoked" } : item,
          ) ?? [],
      )
    },
  })
}
