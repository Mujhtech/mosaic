import type { MetricValue } from "../types/analytics";
import { formatAnalyticsMetric } from "../types/format-analytics-metric";

export function MetricGrid({ metrics }: { metrics: MetricValue[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <article className="rounded border p-4" key={metric.metricId}>
          <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            {metric.metricId.replaceAll("_", " ")}
          </p>
          <p className="mt-2 font-semibold text-2xl tabular-nums">
            {formatAnalyticsMetric(metric)}
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {authorityLabel(metric.authority)}
          </p>
          <MetricDetails metric={metric} />
          {metric.warnings.map((warning) => (
            <p
              className="mt-2 text-amber-700 text-xs dark:text-amber-300"
              key={warning}
            >
              {warning}
            </p>
          ))}
        </article>
      ))}
    </div>
  );
}

export function MetricDictionary({ metrics }: { metrics: MetricValue[] }) {
  return (
    <details className="rounded border">
      <summary className="cursor-pointer rounded p-4 font-semibold text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Metric dictionary ({metrics.length})
      </summary>
      <div className="overflow-x-auto border-t">
        <table className="w-full min-w-180 text-left text-sm">
          <caption className="sr-only">
            Definitions for every metric returned by Mosaic
          </caption>
          <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
            <tr>
              <th className="px-4 py-3" scope="col">
                Metric
              </th>
              <th className="px-4 py-3" scope="col">
                Event basis
              </th>
              <th className="px-4 py-3" scope="col">
                Authority
              </th>
              <th className="px-4 py-3" scope="col">
                Handling
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {metrics.map((metric) => (
              <tr key={metric.metricId}>
                <th className="px-4 py-4 align-top" scope="row">
                  <span className="font-medium">
                    {metric.metricId.replaceAll("_", " ")}
                  </span>
                  <span className="mt-1 block max-w-sm font-normal text-muted-foreground text-xs">
                    {metric.definition ?? "Definition unavailable"}
                  </span>
                </th>
                <td className="px-4 py-4 align-top text-xs">
                  Numerator: <code>{metric.numerator.toLocaleString()}</code>
                  <span className="block text-muted-foreground">
                    Denominator:{" "}
                    {metric.denominator?.toLocaleString() ?? "Not applicable"}
                  </span>
                </td>
                <td className="px-4 py-4 align-top">
                  {authorityLabel(metric.authority)}
                </td>
                <td className="max-w-sm px-4 py-4 align-top text-muted-foreground text-xs">
                  Basis: {metric.basis ?? "Unavailable"} · Attribution:{" "}
                  {metric.attributionWindow ?? "Unavailable"} · Timezone:{" "}
                  {metric.timezone ?? "Unavailable"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function MetricDetails({ metric }: { metric: MetricValue }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Metric definition
      </summary>
      <div className="mt-2 space-y-1 text-muted-foreground leading-5">
        <p>{metric.definition ?? "Definition unavailable"}</p>
        <p>Numerator: {metric.numerator.toLocaleString()}</p>
        <p>
          Denominator:{" "}
          {metric.denominator?.toLocaleString() ?? "Not applicable"}
        </p>
        <p>Basis: {metric.basis ?? "Unavailable"}</p>
        <p>Attribution: {metric.attributionWindow ?? "Unavailable"}</p>
        <p>Timezone: {metric.timezone ?? "Unavailable"}</p>
      </div>
    </details>
  );
}

function authorityLabel(authority: MetricValue["authority"]) {
  if (authority === "provider_confirmed") {
    return "Provider-confirmed";
  }
  if (authority === "trusted_server") {
    return "Trusted server";
  }
  return "Client-observed";
}
