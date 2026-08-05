import type { TrendSeriesSlot } from "@/components/charts/trend-scale";
import type { AnalyticsMetricSeries } from "@/generated/api";
import { ApiError } from "@/lib/api/errors";

import type { Freshness } from "./analytics";

/** What the daily-series endpoint answers, in the shape the surface reads. */
export interface AnalyticsSeriesResult {
  /** The window the server actually served, which it may have clamped. */
  days: number;
  freshness: Freshness;
  series: AnalyticsMetricSeries[];
}

export interface AnalyticsTrendMetric {
  id: string;
  label: string;
  slot: TrendSeriesSlot;
}

export interface AnalyticsTrendView {
  captions: readonly string[];
  id: string;
  /** Counts and rates never share a y-axis, so a view is one or the other. */
  kind: "count" | "rate";
  label: string;
  metrics: readonly AnalyticsTrendMetric[];
}

export const CLIENT_OBSERVED_CAPTION =
  "Client-observed. Mosaic cannot confirm this against a provider.";

/**
 * Slots are assigned per measure, not per selection.
 *
 * The presentation that starts the journey is always slot 1 and the outcome it
 * is compared against is always slot 2, so switching views never repaints a
 * line a reader has already learned.
 */
const PAYWALL_VIEWS: AnalyticsTrendMetric = {
  id: "paywall_presentations",
  label: "Paywall views",
  slot: 1,
};
const PURCHASE_STARTS: AnalyticsTrendMetric = {
  id: "purchase_starts",
  label: "Purchase starts",
  slot: 2,
};
const COMPLETED_PURCHASES: AnalyticsTrendMetric = {
  id: "client_completed_purchases",
  label: "Completed purchases",
  slot: 2,
};
const PRODUCT_SELECTIONS: AnalyticsTrendMetric = {
  id: "product_selections",
  label: "Product selections",
  slot: 2,
};

/**
 * The selectable views for the Analytics trend card.
 *
 * A view plots two series only when both are event counts in the same unit, so
 * one zero-anchored axis serves both honestly. Every rate is drawn alone: a
 * ratio and a count would need two y-scales, and the alignment between them is
 * arbitrary — it invents a correlation the data does not contain.
 */
export const ANALYTICS_TREND_VIEWS: readonly [
  AnalyticsTrendView,
  ...AnalyticsTrendView[],
] = [
  {
    captions: [CLIENT_OBSERVED_CAPTION],
    id: "views-and-starts",
    kind: "count",
    label: "Views & purchase starts",
    metrics: [PAYWALL_VIEWS, PURCHASE_STARTS],
  },
  {
    captions: [CLIENT_OBSERVED_CAPTION],
    id: "views-and-purchases",
    kind: "count",
    label: "Views & completed purchases",
    metrics: [PAYWALL_VIEWS, COMPLETED_PURCHASES],
  },
  {
    captions: [],
    id: "paywall-views",
    kind: "count",
    label: "Paywall views",
    metrics: [PAYWALL_VIEWS],
  },
  {
    captions: [],
    id: "product-selections",
    kind: "count",
    label: "Product selections",
    metrics: [PRODUCT_SELECTIONS],
  },
  {
    captions: [],
    id: "purchase-starts",
    kind: "count",
    label: "Purchase starts",
    metrics: [PURCHASE_STARTS],
  },
  {
    captions: [CLIENT_OBSERVED_CAPTION],
    id: "completed-purchases",
    kind: "count",
    label: "Completed purchases",
    metrics: [COMPLETED_PURCHASES],
  },
  {
    captions: [CLIENT_OBSERVED_CAPTION],
    id: "start-rate",
    kind: "rate",
    label: "View → purchase start rate",
    metrics: [
      {
        id: "presentation_to_purchase_start_rate",
        label: "View → purchase start rate",
        slot: 1,
      },
    ],
  },
  {
    captions: [CLIENT_OBSERVED_CAPTION],
    id: "purchase-rate",
    kind: "rate",
    label: "View → completed purchase rate",
    metrics: [
      {
        id: "presentation_to_client_completed_purchase_rate",
        label: "View → completed purchase rate",
        slot: 1,
      },
    ],
  },
  {
    captions: [],
    id: "failure-rate",
    kind: "rate",
    label: "Purchase failure rate",
    metrics: [
      {
        id: "purchase_failure_rate",
        label: "Purchase failure rate",
        slot: 1,
      },
    ],
  },
];

export const ANALYTICS_TREND_RANGES = [7, 30, 90] as const;
export type AnalyticsTrendRange = (typeof ANALYTICS_TREND_RANGES)[number];
export const DEFAULT_ANALYTICS_TREND_RANGE: AnalyticsTrendRange = 30;

/** The lead count each funnel surface charts beside its own table. */
export const FUNNEL_TREND_METRICS: Record<
  "placements" | "paywalls" | "products" | "purchases",
  AnalyticsTrendMetric
> = {
  placements: {
    id: "placement_requests",
    label: "Placement requests",
    slot: 1,
  },
  paywalls: PAYWALL_VIEWS,
  products: PRODUCT_SELECTIONS,
  purchases: COMPLETED_PURCHASES,
};

const METRIC_LABELS = new Map(
  [
    ...ANALYTICS_TREND_VIEWS.flatMap((view) => view.metrics),
    ...Object.values(FUNNEL_TREND_METRICS),
    {
      id: "presentation_to_product_selection_rate",
      label: "View → selection rate",
    },
    {
      id: "product_selection_to_purchase_start_rate",
      label: "Selection → purchase start rate",
    },
    { id: "purchase_cancellation_rate", label: "Purchase cancellation rate" },
  ].map((metric) => [metric.id, metric.label] as const)
);

/** A wire metric identifier in the words the surface uses for it. */
export function analyticsMetricLabel(id: string) {
  return METRIC_LABELS.get(id) ?? id.replaceAll("_", " ");
}

const FILTER_LABELS: Record<string, string> = {
  applicationVersion: "App version",
  locale: "Locale",
  platform: "Platform",
};

export interface DimensionRefusal {
  /** The refused filter keys, so exactly those can be offered for clearing. */
  dimensions: string[];
  /** The same filters, in the words the filter row uses. */
  filters: string[];
  /** The metrics the server named, in the words the chart uses. */
  metrics: string[];
}

const REFUSAL_CODE = "analytics_dimension_unsupported";
const NAMED_METRICS = /for (.+?)\.?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the 422 the daily series answers when a filter and a metric disagree.
 *
 * The correlated funnel metrics are aggregated undimensioned, so the server
 * refuses the combination rather than quietly answering with every platform's
 * numbers — a chart drawn from unfiltered totals under a filtered heading looks
 * exactly like a correct one. The refusal names both sides, and both are shown:
 * neither the filter nor the metric may be dropped on the reader's behalf.
 */
export function describeDimensionRefusal(
  error: unknown
): DimensionRefusal | null {
  if (!(error instanceof ApiError) || error.code !== REFUSAL_CODE) {
    return null;
  }
  const fields = isRecord(error.details) ? error.details : {};
  const dimensions: string[] = [];
  const filters: string[] = [];
  const metrics = new Set<string>();

  for (const [dimension, messages] of Object.entries(fields)) {
    dimensions.push(dimension);
    filters.push(FILTER_LABELS[dimension] ?? dimension);
    const named = Array.isArray(messages) ? messages : [messages];
    for (const message of named) {
      if (typeof message !== "string") {
        continue;
      }
      const matched = NAMED_METRICS.exec(message)?.[1];
      if (!matched) {
        continue;
      }
      for (const id of matched.split(",")) {
        metrics.add(analyticsMetricLabel(id.trim()));
      }
    }
  }

  return filters.length > 0
    ? { dimensions, filters, metrics: [...metrics] }
    : null;
}

/** The dimension filters a chart may offer to clear, and nothing else. */
export const CLEARABLE_ANALYTICS_DIMENSIONS = [
  "applicationVersion",
  "locale",
  "platform",
] as const;

const seriesCountFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});
const seriesRateFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: "percent",
});

/** One plotted value, printed the way the metric tiles print the same measure. */
export function formatAnalyticsSeriesValue(
  value: number,
  kind: AnalyticsTrendView["kind"]
) {
  return kind === "rate"
    ? seriesRateFormat.format(value)
    : seriesCountFormat.format(value);
}

/**
 * Why a series carries no points, in words that do not read as "zero".
 *
 * `provider_confirmed_unavailable` is the one reason the daily series reports:
 * Mosaic declares the metric but does not compute it, which is a different
 * claim from "it happened zero times" and must never be drawn as a flat line.
 */
export function describeSeriesUnavailable(
  reason: AnalyticsMetricSeries["reason"]
) {
  if (reason === "provider_confirmed_unavailable") {
    return "Mosaic does not compute this metric yet, so it has no daily values. It is never shown as zero. Provider-confirmed measurement requires a trusted server or provider source.";
  }
  return "Mosaic could not read a daily series for this metric. The failure is recorded server-side; retry to read it again.";
}
