import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import type { AnalyticsAdapter } from "../api/analytics-adapter";
import { funnelQueryOptions } from "../queries/analytics-queries";
import type { AnalyticsFilters, AnalyticsScope } from "../types/analytics";
import { FunnelTable } from "./funnel-table";
import { AnalyticsQueryResult } from "./query-result";

export function FunnelPanel({
  adapter,
  filters,
  funnel,
  scope,
}: {
  adapter: AnalyticsAdapter;
  filters: AnalyticsFilters;
  funnel: "placements" | "paywalls" | "products" | "purchases";
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
          return <FunnelTable report={query.data} />;
        }
        return null;
      })()}
    </AnalyticsQueryResult>
  );
}
