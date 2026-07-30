import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut"
import { useQuery } from "@tanstack/react-query"

import { EmptyState } from "@/components/feedback/empty-state"
import type { AnalyticsAdapter } from "../api/analytics-adapter"
import { issuesQueryOptions } from "../queries/analytics-queries"
import type { AnalyticsFilters, AnalyticsScope, IssueRow } from "../types/analytics"
import { AnalyticsQueryResult } from "./query-result"

export function IssuesPanel({
  adapter,
  filters,
  scope,
}: {
  adapter: AnalyticsAdapter
  filters: AnalyticsFilters
  scope: AnalyticsScope
}) {
  const query = useQuery(issuesQueryOptions(scope, filters, adapter))
  return (
    <AnalyticsQueryResult
      error={query.error}
      isPending={query.isPending}
      onRetry={() => void query.refetch()}
    >
      {query.data?.length === 0 ? (
        <EmptyState
          description="No safe Product, provider, or Placement failure codes were recorded for these filters."
          title="No issues detected"
        />
      ) : query.data ? (
        <div className="overflow-x-auto rounded border">
          <table className="w-full min-w-160 text-left text-sm">
            <caption className="sr-only">Product, provider, and Placement recovery issues</caption>
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-3" scope="col">
                  Issue
                </th>
                <th className="px-4 py-3" scope="col">
                  Safe code
                </th>
                <th className="px-4 py-3" scope="col">
                  Count
                </th>
                <th className="px-4 py-3" scope="col">
                  Recovery
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {query.data.map((issue) => (
                <IssueTableRow issue={issue} scope={scope} key={issue.id} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AnalyticsQueryResult>
  )
}

function IssueTableRow({ issue, scope }: { issue: IssueRow; scope: AnalyticsScope }) {
  const href =
    issue.kind === "provider"
      ? `/orgs/${scope.organizationId}/projects/${scope.projectId}/catalog/providers?environmentId=${scope.environmentId}`
      : issue.kind === "product"
        ? `/orgs/${scope.organizationId}/projects/${scope.projectId}/catalog/products`
        : `/orgs/${scope.organizationId}/projects/${scope.projectId}/monetization/${scope.environmentId}/placements${issue.recoveryId ? `/${issue.recoveryId}` : ""}`
  return (
    <tr>
      <th className="px-4 py-4 font-medium" scope="row">
        {issue.label}
      </th>
      <td className="px-4 py-4 font-mono text-xs">{issue.safeCode}</td>
      <td className="px-4 py-4 tabular-nums">
        {issue.count.toLocaleString()}
        {issue.rate === undefined ? "" : ` · ${(issue.rate * 100).toFixed(1)}%`}
      </td>
      <td className="px-4 py-4">
        <a
          className="text-primary inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
          href={href}
        >
          Open recovery <ArrowSquareOutIcon aria-hidden size={15} />
        </a>
      </td>
    </tr>
  )
}
