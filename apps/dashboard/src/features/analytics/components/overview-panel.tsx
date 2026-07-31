import { useQuery } from "@tanstack/react-query";

import { EmptyState } from "@/components/feedback/empty-state";
import type { AnalyticsAdapter } from "../api/analytics-adapter";
import {
  breakdownsQueryOptions,
  overviewQueryOptions,
} from "../queries/analytics-queries";
import type { AnalyticsFilters, AnalyticsScope } from "../types/analytics";
import { FreshnessBanner, WarningList } from "./analytics-states";
import { BreakdownTables } from "./breakdown-tables";
import { MetricDictionary, MetricGrid } from "./metric-grid";
import { AnalyticsQueryResult } from "./query-result";

export function OverviewPanel({
  adapter,
  filters,
  scope,
}: {
  adapter: AnalyticsAdapter;
  filters: AnalyticsFilters;
  scope: AnalyticsScope;
}) {
  const overview = useQuery(overviewQueryOptions(scope, filters, adapter));
  const breakdowns = useQuery(breakdownsQueryOptions(scope, filters, adapter));
  return (
    <AnalyticsQueryResult
      error={overview.error}
      isPending={overview.isPending}
      onRetry={() => {
        overview.refetch();
      }}
    >
      {overview.data?.metrics.length === 0 ? (
        <EmptyState
          description="No accepted analytics events match this Environment and filter range."
          title="No analytics data"
        />
      ) : overview.data ? (
        <div className="space-y-4">
          <FreshnessBanner freshness={overview.data.freshness} />
          <WarningList warnings={overview.data.warnings} />
          <MetricGrid metrics={overview.data.metrics} />
          <MetricDictionary metrics={overview.data.metrics} />
          <AnalyticsQueryResult
            error={breakdowns.error}
            isPending={breakdowns.isPending}
            onRetry={() => {
              breakdowns.refetch();
            }}
          >
            {breakdowns.data ? (
              <BreakdownTables breakdowns={breakdowns.data} />
            ) : null}
          </AnalyticsQueryResult>
        </div>
      ) : null}
    </AnalyticsQueryResult>
  );
}
