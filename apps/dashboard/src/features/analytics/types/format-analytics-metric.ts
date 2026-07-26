import type { MetricValue } from "./analytics"

export function formatAnalyticsMetric(metric: MetricValue) {
  if (!metric.available) return "Unavailable"
  if (metric.metricId.endsWith("_rate")) return `${((metric.value ?? 0) * 100).toFixed(1)}%`
  return (metric.value ?? metric.numerator).toLocaleString()
}
