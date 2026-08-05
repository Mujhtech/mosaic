import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import type { AnalyticsAdapter } from "../api/analytics-adapter";
import { funnelQueryOptions } from "../queries/analytics-queries";
import type { AnalyticsFilters, AnalyticsScope } from "../types/analytics";
import { AnalyticsFunnelTrend } from "./analytics-trend-chart";
import { FunnelTable } from "./funnel-table";
import { AnalyticsQueryResult } from "./query-result";

export function FunnelPanel({
  adapter,
  filters,
  funnel,
  onFiltersChange,
  scope,
}: {
  adapter: AnalyticsAdapter;
  filters: AnalyticsFilters;
  funnel: "placements" | "paywalls" | "products" | "purchases";
  onFiltersChange?: (filters: AnalyticsFilters) => void;
  scope: AnalyticsScope;
}) {
  const query = useQuery(funnelQueryOptions(scope, funnel, filters, adapter));
  const handleRetry = useCallback(() => {
    query.refetch();
  }, [query]);
  return (
    <AnalyticsQueryResult
      error={query.error}
      isPending={query.isPending}
      onRetry={handleRetry}
    >
      {(() => {
        if (query.data?.steps.length === 0) {
          return (
            <EmptyState
              description="No correlated events match this Environment and filter range."
              title="No funnel data"
            />
          );
        }
        if (query.data) {
          return (
            <div className="space-y-4">
              <FunnelTable report={query.data} />
              {/* The table sums the selected range; this says whether that sum
                  is a level or a slope. */}
              <AnalyticsFunnelTrend
                adapter={adapter}
                filters={filters}
                funnel={funnel}
                onFiltersChange={onFiltersChange}
                scope={scope}
              />
            </div>
          );
        }
        return null;
      })()}
    </AnalyticsQueryResult>
  );
}
