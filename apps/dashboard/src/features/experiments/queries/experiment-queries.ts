import { queryOptions } from "@tanstack/react-query";

import type { ExperimentAdapter } from "../api/experiment-adapter";
import type { ExperimentScope } from "../types/experiment";

const scopeKey = (scope: ExperimentScope) =>
  [scope.projectId, scope.environmentId] as const;

export const experimentKeys = {
  all: ["experiments"] as const,
  detail: (scope: ExperimentScope, experimentId: string) =>
    [
      ...experimentKeys.all,
      ...scopeKey(scope),
      "detail",
      experimentId,
    ] as const,
  history: (scope: ExperimentScope, experimentId: string) =>
    [
      ...experimentKeys.all,
      ...scopeKey(scope),
      "history",
      experimentId,
    ] as const,
  list: (scope: ExperimentScope) =>
    [...experimentKeys.all, ...scopeKey(scope), "list"] as const,
  metrics: (scope: ExperimentScope) =>
    [...experimentKeys.all, ...scopeKey(scope), "metrics"] as const,
  groups: (scope: ExperimentScope) =>
    [...experimentKeys.all, ...scopeKey(scope), "groups"] as const,
  groupVersions: (scope: ExperimentScope, groupId: string) =>
    [...experimentKeys.groups(scope), groupId, "versions"] as const,
  paywallVersions: (scope: ExperimentScope) =>
    [...experimentKeys.all, ...scopeKey(scope), "paywall-versions"] as const,
  qa: (scope: ExperimentScope, experimentId: string) =>
    [...experimentKeys.all, ...scopeKey(scope), "qa", experimentId] as const,
  results: (scope: ExperimentScope, experimentId: string) =>
    [
      ...experimentKeys.all,
      ...scopeKey(scope),
      "results",
      experimentId,
    ] as const,
};

export function experimentsQueryOptions(
  scope: ExperimentScope,
  adapter: ExperimentAdapter
) {
  return queryOptions({
    queryKey: [...experimentKeys.list(scope), adapter],
    queryFn: () => adapter.list(scope),
  });
}

export function experimentGroupsQueryOptions(
  scope: ExperimentScope,
  adapter: ExperimentAdapter
) {
  return queryOptions({
    queryKey: [...experimentKeys.groups(scope), adapter],
    queryFn: () => adapter.listMutualExclusionGroups(scope),
  });
}

export function experimentGroupVersionsQueryOptions(
  scope: ExperimentScope,
  groupId: string,
  adapter: ExperimentAdapter
) {
  return queryOptions({
    enabled: Boolean(groupId),
    queryKey: [...experimentKeys.groupVersions(scope, groupId), adapter],
    queryFn: () => adapter.listMutualExclusionGroupVersions(scope, groupId),
  });
}

export function experimentQueryOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter
) {
  return queryOptions({
    queryKey: [...experimentKeys.detail(scope, experimentId), adapter],
    queryFn: () => adapter.get(scope, experimentId),
  });
}

export function experimentBuilderResourcesQueryOptions(
  scope: ExperimentScope,
  adapter: ExperimentAdapter
) {
  return queryOptions({
    queryKey: [
      ...experimentKeys.all,
      ...scopeKey(scope),
      "builder-resources",
      adapter,
    ],
    queryFn: async () => {
      const [paywallVersions, metrics, groups] = await Promise.all([
        adapter.listImmutablePaywallVersions(scope),
        adapter.listMetricDefinitions(scope),
        adapter.listMutualExclusionGroups(scope),
      ]);
      return { groups, metrics, paywallVersions };
    },
  });
}

export function experimentResultsQueryOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter
) {
  return queryOptions({
    queryKey: [...experimentKeys.results(scope, experimentId), adapter],
    queryFn: () => adapter.results(scope, experimentId),
    refetchInterval: 60_000,
  });
}

export function experimentHistoryQueryOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter
) {
  return queryOptions({
    queryKey: [...experimentKeys.history(scope, experimentId), adapter],
    queryFn: () => adapter.history(scope, experimentId),
  });
}

export function experimentQaQueryOptions(
  scope: ExperimentScope,
  experimentId: string,
  adapter: ExperimentAdapter
) {
  return queryOptions({
    queryKey: [...experimentKeys.qa(scope, experimentId), adapter],
    queryFn: () => adapter.listQaOverrides(scope, experimentId),
  });
}
