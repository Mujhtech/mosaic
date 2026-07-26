import type { FunnelReport } from "../types/analytics"
import { FreshnessBanner, LowDataNotice, WarningList } from "./analytics-states"

export function FunnelTable({ report }: { report: FunnelReport }) {
  const maximum = Math.max(
    ...report.steps.filter((step) => step.available).map((step) => step.count),
    1,
  )
  return (
    <div className="space-y-4">
      <FreshnessBanner freshness={report.freshness} />
      <LowDataNotice sampleSize={report.sampleSize} />
      <WarningList warnings={report.warnings} />
      <div className="overflow-x-auto rounded border">
        <table className="w-full min-w-160 text-left text-sm">
          <caption className="sr-only">
            {report.title}. Steps are correlated using {report.correlationKey}.
          </caption>
          <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-4 py-3" scope="col">
                Step
              </th>
              <th className="px-4 py-3" scope="col">
                Accepted events
              </th>
              <th className="px-4 py-3" scope="col">
                Drop-off
              </th>
              <th className="w-2/5 px-4 py-3" scope="col">
                Relative volume
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {report.steps.map((step) => (
              <tr key={step.id}>
                <th className="px-4 py-4 font-medium" scope="row">
                  {step.label}
                  <span className="text-muted-foreground mt-0.5 block font-mono text-xs">
                    {step.eventName}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {authorityLabel(step.authority)}
                    {!step.available ? " · Unavailable" : ""}
                  </span>
                </th>
                <td className="px-4 py-4 tabular-nums">
                  {step.available ? step.count.toLocaleString() : "Unavailable"}
                </td>
                <td className="px-4 py-4 tabular-nums">
                  {step.dropOff === undefined ? "—" : `${(step.dropOff * 100).toFixed(1)}%`}
                </td>
                <td className="px-4 py-4">
                  {step.available ? (
                    <div className="bg-muted h-3 overflow-hidden rounded-full">
                      <div
                        aria-label={`${step.label}: ${step.count.toLocaleString()} events`}
                        className="bg-primary h-full rounded-full"
                        role="img"
                        style={{
                          width: `${Math.max((step.count / maximum) * 100, step.count ? 2 : 0)}%`,
                        }}
                      />
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Unavailable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">
        Exact correlation: {report.correlationKey}. Events are grouped by occurrence time;
        duplicates are excluded.
      </p>
    </div>
  )
}

function authorityLabel(authority: FunnelReport["steps"][number]["authority"]) {
  if (authority === "provider_confirmed") return "Provider-confirmed"
  if (authority === "trusted_server") return "Trusted server"
  return "Client-observed"
}
