import { queryOptions } from "@tanstack/react-query"

import type {
  DecisionScope,
  PlacementDecisionsAdapter,
} from "@/features/placement-decisions/api/placement-decisions-adapter"

export const placementDecisionKeys = {
  all: ["placement-decisions"] as const,
  attributes: (projectId: string, adapter: PlacementDecisionsAdapter) =>
    ["placement-decisions", projectId, "attributes", adapter] as const,
  detail: (scope: DecisionScope, adapter: PlacementDecisionsAdapter) =>
    [
      "placement-decisions",
      scope.projectId,
      scope.environmentId,
      scope.placementId,
      adapter,
    ] as const,
  overrides: (scope: DecisionScope, adapter: PlacementDecisionsAdapter) =>
    [
      "placement-decisions",
      scope.projectId,
      scope.environmentId,
      scope.placementId,
      "overrides",
      adapter,
    ] as const,
}

export function placementDecisionQueryOptions(
  scope: DecisionScope,
  adapter: PlacementDecisionsAdapter,
) {
  return queryOptions({
    queryKey: placementDecisionKeys.detail(scope, adapter),
    queryFn: () => adapter.getPlacementDecision(scope),
  })
}

export function attributeDefinitionsQueryOptions(
  projectId: string,
  adapter: PlacementDecisionsAdapter,
) {
  return queryOptions({
    queryKey: placementDecisionKeys.attributes(projectId, adapter),
    queryFn: () => adapter.listAttributes(projectId),
  })
}

export function qaOverridesQueryOptions(scope: DecisionScope, adapter: PlacementDecisionsAdapter) {
  return queryOptions({
    queryKey: placementDecisionKeys.overrides(scope, adapter),
    queryFn: () => adapter.listOverrides(scope),
  })
}
