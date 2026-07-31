import { queryOptions } from "@tanstack/react-query"

import type { AnalyticsAdapter } from "../api/analytics-adapter"
import type { AnalyticsFilters, AnalyticsScope } from "../types/analytics"

const scopeKey = (scope: AnalyticsScope) => [scope.projectId, scope.environmentId] as const
const filterKey = (filters: AnalyticsFilters) => ({ ...filters })

export const analyticsKeys = {
  all: ["analytics"] as const,
  overview: (scope: AnalyticsScope, filters: AnalyticsFilters) =>
    [...analyticsKeys.all, ...scopeKey(scope), "overview", filterKey(filters)] as const,
  breakdowns: (scope: AnalyticsScope, filters: AnalyticsFilters) =>
    [...analyticsKeys.all, ...scopeKey(scope), "breakdowns", filterKey(filters)] as const,
  funnel: (scope: AnalyticsScope, funnel: string, filters: AnalyticsFilters) =>
    [...analyticsKeys.all, ...scopeKey(scope), "funnel", funnel, filterKey(filters)] as const,
  comparison: (scope: AnalyticsScope, filters: AnalyticsFilters) =>
    [...analyticsKeys.all, ...scopeKey(scope), "comparison", filterKey(filters)] as const,
  issues: (scope: AnalyticsScope, filters: AnalyticsFilters) =>
    [...analyticsKeys.all, ...scopeKey(scope), "issues", filterKey(filters)] as const,
  settings: (scope: AnalyticsScope) =>
    [...analyticsKeys.all, ...scopeKey(scope), "settings"] as const,
  job: (scope: AnalyticsScope, jobId: string) =>
    [...analyticsKeys.all, ...scopeKey(scope), "job", jobId] as const,
}

export function overviewQueryOptions(
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter,
) {
  return queryOptions({
    queryKey: [...analyticsKeys.overview(scope, filters), adapter],
    queryFn: ({ signal }) => adapter.getOverview(scope, filters, signal),
  })
}

export function breakdownsQueryOptions(
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter,
) {
  return queryOptions({
    queryKey: [...analyticsKeys.breakdowns(scope, filters), adapter],
    queryFn: ({ signal }) => adapter.getBreakdowns(scope, filters, signal),
  })
}

export function funnelQueryOptions(
  scope: AnalyticsScope,
  funnel: "placements" | "paywalls" | "products" | "purchases",
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter,
) {
  return queryOptions({
    queryKey: [...analyticsKeys.funnel(scope, funnel, filters), adapter],
    queryFn: ({ signal }) => adapter.getFunnel(scope, funnel, filters, signal),
  })
}

export function comparisonQueryOptions(
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter,
) {
  return queryOptions({
    queryKey: [...analyticsKeys.comparison(scope, filters), adapter],
    queryFn: ({ signal }) => adapter.getPaywallComparison(scope, filters, signal),
  })
}

export function issuesQueryOptions(
  scope: AnalyticsScope,
  filters: AnalyticsFilters,
  adapter: AnalyticsAdapter,
) {
  return queryOptions({
    queryKey: [...analyticsKeys.issues(scope, filters), adapter],
    queryFn: ({ signal }) => adapter.getIssues(scope, filters, signal),
  })
}

export function settingsQueryOptions(scope: AnalyticsScope, adapter: AnalyticsAdapter) {
  return queryOptions({
    queryKey: [...analyticsKeys.settings(scope), adapter],
    queryFn: ({ signal }) => adapter.getCollectionSettings(scope, signal),
  })
}

export function jobQueryOptions(scope: AnalyticsScope, jobId: string, adapter: AnalyticsAdapter) {
  return queryOptions({
    queryKey: [...analyticsKeys.job(scope, jobId), adapter],
    queryFn: ({ signal }) => adapter.getJob(scope, jobId, signal),
    refetchInterval: (query) => {
      const state = query.state.data?.state
      return state === "queued" || state === "leased" ? 2_000 : false
    },
  })
}
