import type { MetricValue } from "./analytics";

/**
 * Shown for a metric that is available in principle but carries no value.
 *
 * Distinct from "Unavailable", which means the metric itself is not being
 * produced. Neither may be rendered as a number: a rate with no value used to
 * print "0.0%", which reads as a measured conversion floor and is the single
 * most misleading thing an analytics surface can say.
 */
export const METRIC_NOT_REPORTED = "Not reported";

export function formatAnalyticsMetric(metric: MetricValue) {
  if (!metric.available) {
    return "Unavailable";
  }
  if (metric.metricId.endsWith("_rate")) {
    return typeof metric.value === "number"
      ? `${(metric.value * 100).toFixed(1)}%`
      : METRIC_NOT_REPORTED;
  }
  // A count legitimately falls back to its numerator — that is the same
  // measurement, not a substitute for a missing one.
  const count = metric.value ?? metric.numerator;
  return typeof count === "number"
    ? count.toLocaleString()
    : METRIC_NOT_REPORTED;
}
