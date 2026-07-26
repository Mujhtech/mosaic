import type { AnalyticsBreakdown } from "../types/analytics"

export function BreakdownTables({ breakdowns }: { breakdowns: AnalyticsBreakdown[] }) {
  return (
    <section aria-labelledby="analytics-breakdowns-title" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold" id="analytics-breakdowns-title">
          Event breakdowns
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Accepted, deduplicated event counts for the active date range and filters.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {breakdowns.map((breakdown) => (
          <div className="overflow-x-auto rounded border" key={breakdown.dimension}>
            <table className="w-full text-left text-sm">
              <caption className="px-4 py-3 text-left font-semibold capitalize">
                By {breakdown.dimension}
              </caption>
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-4 py-3" scope="col">
                    {breakdown.dimension}
                  </th>
                  <th className="px-4 py-3 text-right" scope="col">
                    Events
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {breakdown.rows.length === 0 ? (
                  <tr>
                    <td className="text-muted-foreground px-4 py-4" colSpan={2}>
                      No data for this breakdown.
                    </td>
                  </tr>
                ) : (
                  breakdown.rows.map((row) => (
                    <tr key={`${breakdown.dimension}:${row.label}`}>
                      <th className="px-4 py-3 font-medium" scope="row">
                        {row.label}
                      </th>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.count.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  )
}
