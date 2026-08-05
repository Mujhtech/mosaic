import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import type { AnalyticsAdapter } from "../api/analytics-adapter";
import {
  breakdownsQueryOptions,
  overviewQueryOptions,
} from "../queries/analytics-queries";
import type { AnalyticsFilters, AnalyticsScope } from "../types/analytics";
import { FreshnessBanner, WarningList } from "./analytics-states";
import { AnalyticsTrendChart } from "./analytics-trend-chart";
import { BreakdownTables } from "./breakdown-tables";
import { MetricDictionary, MetricGrid } from "./metric-grid";
import { AnalyticsQueryResult } from "./query-result";

export function OverviewPanel({
  adapter,
  filters,
  onFiltersChange,
  scope,
}: {
  adapter: AnalyticsAdapter;
  filters: AnalyticsFilters;
  onFiltersChange?: (filters: AnalyticsFilters) => void;
  scope: AnalyticsScope;
}) {
  const overview = useQuery(overviewQueryOptions(scope, filters, adapter));
  const handleRetry = useCallback(() => {
    overview.refetch();
  }, [overview]);
  const breakdowns = useQuery(breakdownsQueryOptions(scope, filters, adapter));
  const handleRetry2 = useCallback(() => {
    breakdowns.refetch();
  }, [breakdowns]);
  return (
    <AnalyticsQueryResult
      error={overview.error}
      isPending={overview.isPending}
      onRetry={handleRetry}
    >
      {(() => {
        if (overview.data?.metrics.length === 0) {
          return (
            <EmptyState
              description="No accepted analytics events match this Environment and filter range."
              title="No analytics data"
            />
          );
        }
        if (overview.data) {
          return (
            <div className="space-y-4">
              <FreshnessBanner freshness={overview.data.freshness} />
              <WarningList warnings={overview.data.warnings} />
              <MetricGrid metrics={overview.data.metrics} />
              {/* The tiles answer "what is happening now"; the trend answers
                  "is that normal", which no single number can. */}
              <AnalyticsTrendChart
                adapter={adapter}
                filters={filters}
                onFiltersChange={onFiltersChange}
                scope={scope}
              />
              <MetricDictionary metrics={overview.data.metrics} />
              <AnalyticsQueryResult
                error={breakdowns.error}
                isPending={breakdowns.isPending}
                onRetry={handleRetry2}
              >
                {breakdowns.data ? (
                  <BreakdownTables breakdowns={breakdowns.data} />
                ) : null}
              </AnalyticsQueryResult>
            </div>
          );
        }
        return null;
      })()}
    </AnalyticsQueryResult>
  );
}
