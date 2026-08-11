import { queryOptions } from "@tanstack/react-query";

import type { AnalyticsAdapter } from "../api/analytics-adapter";
import type { AnalyticsFilters, AnalyticsScope } from "../types/analytics";

const scopeKey = (scope: AnalyticsScope) =>
  [scope.projectId, scope.environmentId] as const;
const filterKey = (filters: AnalyticsFilters) => ({ ...filters });

export const analyticsKeys = {
  all: ["analytics"] as const,
  overview: (scope: AnalyticsScope, filters: AnalyticsFilters) =>
    [
      ...analyticsKeys.all,
      ...scopeKey(scope),
      "overview",
      filterKey(filters),
    ] as const,
  breakdowns: (scope: AnalyticsScope, filters: AnalyticsFilters) =>
    [
      ...analyticsKeys.all,
      ...scopeKey(scope),
      "breakdowns",
      filterKey(filters),
    ] as const,
  funnel: (scope: AnalyticsScope, funnel: string, filters: AnalyticsFilters) =>
    [
      ...analyticsKeys.all,
      ...scopeKey(scope),
      "funnel",
      funnel,
      filterKey(filters),
    ] as const,
  series: (
    scope: AnalyticsScope,
    metricIds: readonly string[],
    filters: AnalyticsFilters,
    days: number
  ) =>
    [
      ...analyticsKeys.all,
      ...scopeKey(scope),
      "series",
      [...metricIds].join(","),
      days,
      filterKey(filters),
    ] as const,
  comparison: (scope: AnalyticsScope, filters: AnalyticsFilters) =>
    [
      ...analyticsKeys.all,
      ...scopeKey(scope),
      "comparison",
      filterKey(filters),
    ] as const,
  issues: (scope: AnalyticsScope, filters: AnalyticsFilters) =>
    [
      ...analyticsKeys.all,
      ...scopeKey(scope),
      "issues",
      filterKey(filters),
    ] as const,
  settings: (scope: AnalyticsScope) =>
    [...analyticsKeys.all, ...scopeKey(scope), "settings"] as const,
  job: (scope: AnalyticsScope, jobId: string) =>
    [...analyticsKeys.all, ...scopeKey(scope), "job", jobId] as const,
};

export function overviewQueryOptions(
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter
) {
  return queryOptions({
    queryKey: [...analyticsKeys.overview(scope, filters), adapter],
    queryFn: ({ signal }) => adapter.getOverview(scope, filters, signal),
  });
}

export function breakdownsQueryOptions(
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter
) {
  return queryOptions({
    queryKey: [...analyticsKeys.breakdowns(scope, filters), adapter],
    queryFn: ({ signal }) => adapter.getBreakdowns(scope, filters, signal),
  });
}

export function funnelQueryOptions(
  scope: AnalyticsScope,
  funnel: "placements" | "paywalls" | "products" | "purchases",
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter
) {
  return queryOptions({
    queryKey: [...analyticsKeys.funnel(scope, funnel, filters), adapter],
    queryFn: ({ signal }) => adapter.getFunnel(scope, funnel, filters, signal),
  });
}

/**
 * The daily series behind a trend chart, for one metric set and window.
 *
 * Every filter is part of the key: a platform-filtered series is a different
 * answer, not the same answer redrawn, and the 422 a filter can provoke belongs
 * to that combination alone. Completed days do not change, so a minute of
 * staleness costs nothing while still refreshing today's accruing point often
 * enough to stay honest.
 */
export function seriesQueryOptions(
  scope: AnalyticsScope,
  metricIds: readonly string[],
  filters: AnalyticsFilters,
  days: number,
  adapter: AnalyticsAdapter
) {
  return queryOptions({
    queryKey: [
      ...analyticsKeys.series(scope, metricIds, filters, days),
      adapter,
    ],
    queryFn: ({ signal }) =>
      adapter.getSeries(scope, metricIds, filters, days, signal),
    staleTime: 60_000,
  });
}

export function comparisonQueryOptions(
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter
) {
  return queryOptions({
    queryKey: [...analyticsKeys.comparison(scope, filters), adapter],
    queryFn: ({ signal }) =>
      adapter.getPaywallComparison(scope, filters, signal),
  });
}

export function issuesQueryOptions(
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter
) {
  return queryOptions({
    queryKey: [...analyticsKeys.issues(scope, filters), adapter],
    queryFn: ({ signal }) => adapter.getIssues(scope, filters, signal),
  });
}

export function settingsQueryOptions(
  scope: AnalyticsScope,
  adapter: AnalyticsAdapter
) {
  return queryOptions({
    queryKey: [...analyticsKeys.settings(scope), adapter],
    queryFn: ({ signal }) => adapter.getCollectionSettings(scope, signal),
  });
}

export function jobQueryOptions(
  scope: AnalyticsScope,
  jobId: string,
  adapter: AnalyticsAdapter
) {
  return queryOptions({
    queryKey: [...analyticsKeys.job(scope, jobId), adapter],
    queryFn: ({ signal }) => adapter.getJob(scope, jobId, signal),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "queued" || state === "leased" ? 2000 : false;
    },
  });
}
