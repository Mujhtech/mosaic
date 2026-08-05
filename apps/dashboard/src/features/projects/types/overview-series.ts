import type { TrendSeriesSlot } from "@/components/charts/trend-scale";
import type { ProjectOverviewMetricsSeries } from "@/generated/api";

import type { OverviewMetricKind } from "./overview-metrics";

/** The seven daily measures the series endpoint reports. */
export type OverviewSeriesKey = keyof ProjectOverviewMetricsSeries["metrics"];

/**
 * A series' colour slot. The rule — colour follows the measure, never its
 * position — is the shared chart's; this alias only names it locally.
 */
export type OverviewSeriesSlot = TrendSeriesSlot;

export interface OverviewTrendSeries {
  key: OverviewSeriesKey;
  label: string;
  slot: OverviewSeriesSlot;
}

export interface OverviewTrendView {
  captions: readonly string[];
  id: string;
  /** Counts and rates never share a y-axis, so a view is one or the other. */
  kind: OverviewMetricKind;
  label: string;
  series: readonly OverviewTrendSeries[];
}

export const CLIENT_OBSERVED_CAPTION =
  "Client-observed. Mosaic cannot confirm this against a provider.";

const PAYWALL_VIEWS: OverviewTrendSeries = {
  key: "paywallViews",
  label: "Paywall views",
  slot: 1,
};

const PURCHASES: OverviewTrendSeries = {
  key: "purchases",
  label: "Purchases",
  slot: 2,
};

/**
 * The selectable views.
 *
 * Only the funnel view plots two series, and both of its members are event
 * counts measured in the same unit, so they share one axis honestly. Every
 * other measure is drawn alone: pairing a ratio with a count would need a
 * second y-scale, and the alignment between two such scales is arbitrary — it
 * invents a correlation the data does not contain.
 */
export const OVERVIEW_TREND_VIEWS: readonly [
  OverviewTrendView,
  ...OverviewTrendView[],
] = [
  {
    captions: [CLIENT_OBSERVED_CAPTION],
    id: "funnel",
    kind: "count",
    label: "Views & purchases",
    series: [PAYWALL_VIEWS, PURCHASES],
  },
  {
    captions: [],
    id: "paywallViews",
    kind: "count",
    label: "Paywall views",
    series: [PAYWALL_VIEWS],
  },
  {
    captions: [],
    id: "purchaseStarts",
    kind: "count",
    label: "Purchase starts",
    series: [{ key: "purchaseStarts", label: "Purchase starts", slot: 1 }],
  },
  {
    captions: [CLIENT_OBSERVED_CAPTION],
    id: "purchases",
    kind: "count",
    label: "Purchases",
    series: [PURCHASES],
  },
  {
    captions: [CLIENT_OBSERVED_CAPTION],
    id: "conversionRate",
    kind: "rate",
    label: "Conversion rate",
    series: [{ key: "conversionRate", label: "Conversion rate", slot: 1 }],
  },
  {
    captions: [],
    id: "newCustomers",
    kind: "count",
    label: "New customers",
    series: [{ key: "newCustomers", label: "New customers", slot: 1 }],
  },
  {
    captions: [],
    id: "newSubscriptions",
    kind: "count",
    label: "New subscriptions",
    series: [{ key: "newSubscriptions", label: "New subscriptions", slot: 1 }],
  },
  {
    captions: [],
    id: "trialsStarted",
    kind: "count",
    label: "Trials started",
    series: [{ key: "trialsStarted", label: "Trials started", slot: 1 }],
  },
];

export const OVERVIEW_TREND_RANGES = [7, 30, 90] as const;
export type OverviewTrendRange = (typeof OVERVIEW_TREND_RANGES)[number];
export const DEFAULT_OVERVIEW_TREND_RANGE: OverviewTrendRange = 30;
