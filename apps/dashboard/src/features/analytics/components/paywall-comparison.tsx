import { useQuery } from "@tanstack/react-query"

import { EmptyState } from "@/components/feedback/empty-state"
import type { AnalyticsAdapter } from "../api/analytics-adapter"
import { comparisonQueryOptions } from "../queries/analytics-queries"
import type { AnalyticsFilters, AnalyticsScope } from "../types/analytics"
import { formatAnalyticsMetric } from "../types/format-analytics-metric"
import { LowDataNotice } from "./analytics-states"
import { AnalyticsQueryResult } from "./query-result"

export function PaywallComparison({
  adapter,
  filters,
  scope,
}: {
  adapter: AnalyticsAdapter
  filters: AnalyticsFilters
  scope: AnalyticsScope
}) {
  const query = useQuery(comparisonQueryOptions(scope, filters, adapter))
  return (
    <AnalyticsQueryResult
      error={query.error}
      isPending={query.isPending}
      onRetry={() => void query.refetch()}
    >
      {query.data?.length === 0 ? (
        <EmptyState
          description="No immutable Paywall Versions have comparable data for these filters."
          title="No versions to compare"
        />
      ) : query.data ? (
        <div className="space-y-4">
          <div className="border-primary/20 bg-primary/5 rounded border p-3 text-sm" role="status">
            Versions are immutable and compared on the same event-count basis, filters, timezone,
            and 24-hour correlation window. Results below the data threshold are descriptive only.
          </div>
          <div className="overflow-x-auto rounded border">
            <table className="w-full min-w-180 text-left text-sm">
              <caption className="sr-only">Immutable Paywall Version comparison</caption>
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-4 py-3" scope="col">
                    Paywall Version
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Presentations
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Metric
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Authority
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Data quality
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {query.data.map((row) => (
                  <tr key={row.paywallVersionId}>
                    <th className="px-4 py-4" scope="row">
                      <span className="font-medium">
                        {row.paywallName}
                        {row.versionNumber > 0 ? ` · v${row.versionNumber}` : ""}
                      </span>
                      <code className="text-muted-foreground mt-0.5 block text-xs">
                        {row.paywallVersionId}
                      </code>
                    </th>
                    <td className="px-4 py-4 tabular-nums">{row.presentations.toLocaleString()}</td>
                    <td className="px-4 py-4 font-semibold tabular-nums">
                      {formatAnalyticsMetric(row.metric)}
                      <span className="text-muted-foreground mt-1 block font-mono text-xs font-normal">
                        {row.metric.metricId}
                      </span>
                    </td>
                    <td className="px-4 py-4">{row.metric.authority.replace("_", "-")}</td>
                    <td className="px-4 py-4">
                      {row.presentations < 100 ? "Low data — no winner" : "Meets display threshold"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data.length > 0 ? (
            <LowDataNotice sampleSize={Math.min(...query.data.map((row) => row.presentations))} />
          ) : null}
        </div>
      ) : null}
    </AnalyticsQueryResult>
  )
}
