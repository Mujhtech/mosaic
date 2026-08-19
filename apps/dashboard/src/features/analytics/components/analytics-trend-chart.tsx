import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ChartChip } from "@/components/charts/chart-chip";
import {
  TrendChart,
  type TrendChartSeries,
  TrendMessage,
} from "@/components/charts/trend-chart";
import {
  COMPACT_TREND_PLOT_HEIGHT,
  trendFrameHeight,
} from "@/components/charts/trend-frame";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsMetricSeries } from "@/generated/api";
import { describeApiError } from "@/lib/api/errors";
import type { AnalyticsAdapter } from "../api/analytics-adapter";
import { seriesQueryOptions } from "../queries/analytics-queries";
import type {
  AnalyticsFilters,
  AnalyticsScope,
  Freshness,
} from "../types/analytics";
import {
  ANALYTICS_TREND_RANGES,
  ANALYTICS_TREND_VIEWS,
  type AnalyticsTrendRange,
  type AnalyticsTrendView,
  CLEARABLE_ANALYTICS_DIMENSIONS,
  DEFAULT_ANALYTICS_TREND_RANGE,
  describeDimensionRefusal,
  describeSeriesUnavailable,
  FUNNEL_TREND_METRICS,
  formatAnalyticsSeriesValue,
} from "../types/analytics-series";
import { FreshnessBanner } from "./analytics-states";

const PARTIAL_CAPTION = "Today is still accruing.";
const DELAYED_CAPTION =
  "Aggregation is behind, so the most recent days can read low until it catches up.";
/**
 * A missing aggregate watermark is not evidence of a delay. Saying aggregation
 * is behind would manufacture a cause from an absent fact, so the caption
 * reports exactly what happened: the progress marker was not reported.
 */
const FRESHNESS_UNAVAILABLE_CAPTION =
  "Aggregation progress was not reported, so Mosaic cannot say whether the most recent days are complete.";

function freshnessCaptions(state: Freshness["aggregateState"] | undefined) {
  if (state === "delayed") {
    return [DELAYED_CAPTION];
  }
  if (state === "unavailable") {
    return [FRESHNESS_UNAVAILABLE_CAPTION];
  }
  // "current", or no freshness record at all, which the banner already covers.
  return [];
}

/**
 * The unavailable series that share one reason. Distinct reasons are stated
 * separately: reporting only the first would attribute every gap to it.
 */
function groupUnavailable(
  entries: Array<{ label: string; reason?: AnalyticsMetricSeries["reason"] }>
) {
  const groups = new Map<string, { description: string; labels: string[] }>();
  for (const entry of entries) {
    const key = entry.reason ?? "unreported";
    const group = groups.get(key);
    if (group) {
      group.labels.push(entry.label);
      continue;
    }
    groups.set(key, {
      description: describeSeriesUnavailable(entry.reason),
      labels: [entry.label],
    });
  }
  return [...groups.values()];
}

interface TrendScope {
  adapter: AnalyticsAdapter;
  filters: AnalyticsFilters;
  /** Absent where the surface cannot change filters, which disables clearing. */
  onFiltersChange?: (filters: AnalyticsFilters) => void;
  scope: AnalyticsScope;
}

/**
 * The daily trend behind the Analytics numbers, under the surface's own filters.
 *
 * It reads the platform, locale, application-version, basis, and timezone the
 * filter row already holds rather than owning a second set: a chart filtered
 * differently from the table beside it is the most expensive kind of wrong. Its
 * one local control is the window length, which the daily endpoint serves as a
 * clamped day count rather than as the filter row's instants.
 */
export function AnalyticsTrendChart({
  adapter,
  filters,
  onFiltersChange,
  scope,
}: TrendScope) {
  const [viewId, setViewId] = useState(ANALYTICS_TREND_VIEWS[0].id);
  const [days, setDays] = useState<AnalyticsTrendRange>(
    DEFAULT_ANALYTICS_TREND_RANGE
  );
  const view =
    ANALYTICS_TREND_VIEWS.find((candidate) => candidate.id === viewId) ??
    ANALYTICS_TREND_VIEWS[0];

  return (
    <figure className="m-0 space-y-3 rounded-lg border bg-card p-4">
      <figcaption className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-sm">Trend · UTC days</h3>
          <p className="text-muted-foreground text-xs">
            Daily {view.label.toLowerCase()} over the last {days} UTC days,
            under the filters above.
          </p>
        </div>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <fieldset className="flex flex-wrap items-center gap-1.5">
            <legend className="sr-only">Measure to chart</legend>
            {ANALYTICS_TREND_VIEWS.map((candidate) => (
              <ChartChip
                key={candidate.id}
                label={candidate.label}
                onSelect={() => setViewId(candidate.id)}
                selected={candidate.id === view.id}
              />
            ))}
          </fieldset>
          <fieldset className="flex flex-wrap items-center gap-1.5">
            <legend className="sr-only">Window length</legend>
            {ANALYTICS_TREND_RANGES.map((range) => (
              <ChartChip
                key={range}
                label={`${range} days`}
                onSelect={() => setDays(range)}
                selected={range === days}
              />
            ))}
          </fieldset>
        </div>
      </figcaption>

      <TrendBody
        adapter={adapter}
        days={days}
        filters={filters}
        onFiltersChange={onFiltersChange}
        scope={scope}
        view={view}
      />
    </figure>
  );
}

/**
 * The same trend beside a funnel table, for that funnel's own leading count.
 *
 * There is no measure selector here: the surface has already chosen what it is
 * about, and a second selector would let the chart disagree with the table it
 * annotates.
 */
export function AnalyticsFunnelTrend({
  adapter,
  filters,
  funnel,
  onFiltersChange,
  scope,
}: TrendScope & { funnel: keyof typeof FUNNEL_TREND_METRICS }) {
  const metric = FUNNEL_TREND_METRICS[funnel];
  const view = useMemo<AnalyticsTrendView>(
    () => ({
      captions: [],
      id: `funnel-${funnel}`,
      kind: "count",
      label: metric.label,
      metrics: [metric],
    }),
    [funnel, metric]
  );

  return (
    <figure className="m-0 space-y-3 rounded-lg border bg-card p-4">
      <figcaption className="flex flex-col gap-1">
        <h3 className="font-semibold text-sm">{metric.label} by UTC day</h3>
        <p className="text-muted-foreground text-xs">
          The last {DEFAULT_ANALYTICS_TREND_RANGE} UTC days, under the filters
          above. The table reports the selected range.
        </p>
      </figcaption>
      <TrendBody
        adapter={adapter}
        compact
        days={DEFAULT_ANALYTICS_TREND_RANGE}
        filters={filters}
        onFiltersChange={onFiltersChange}
        scope={scope}
        view={view}
      />
    </figure>
  );
}

function TrendBody({
  adapter,
  compact,
  days,
  filters,
  onFiltersChange,
  scope,
  view,
}: TrendScope & {
  compact?: boolean;
  days: number;
  view: AnalyticsTrendView;
}) {
  const metricIds = useMemo(
    () => view.metrics.map((metric) => metric.id),
    [view]
  );
  const query = useQuery(
    seriesQueryOptions(scope, metricIds, filters, days, adapter)
  );
  const plotHeight = compact ? COMPACT_TREND_PLOT_HEIGHT : undefined;

  const resolved = useMemo<TrendChartSeries[]>(() => {
    const answered = query.data?.series ?? [];
    return view.metrics.flatMap((metric) => {
      const value = answered.find((entry) => entry.metricId === metric.id);
      if (!(value?.available && value.points)) {
        return [];
      }
      return [
        {
          key: metric.id,
          label: metric.label,
          points: value.points,
          slot: metric.slot,
        },
      ];
    });
  }, [query.data, view]);

  const unavailable = useMemo(() => {
    const answered = query.data?.series ?? [];
    if (answered.length === 0) {
      return [];
    }
    return view.metrics.flatMap((metric) => {
      const value = answered.find((entry) => entry.metricId === metric.id);
      return value?.available && value.points
        ? []
        : [{ label: metric.label, reason: value?.reason }];
    });
  }, [query.data, view]);

  if (query.isPending) {
    return (
      <Skeleton
        aria-label={`Loading the ${view.label.toLowerCase()} trend`}
        className="w-full"
        style={{ height: trendFrameHeight(plotHeight) }}
      />
    );
  }

  if (query.error) {
    return (
      <TrendFailure
        error={query.error}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onRetry={() => query.refetch()}
        plotHeight={plotHeight}
        scope={scope}
      />
    );
  }

  const freshness = query.data?.freshness;
  const hasPartial = resolved.some((entry) =>
    entry.points.some((point) => point.partial === true)
  );
  const captions = [
    ...view.captions,
    ...(hasPartial ? [PARTIAL_CAPTION] : []),
    ...freshnessCaptions(freshness?.aggregateState),
  ];
  const unavailableGroups = groupUnavailable(unavailable);

  return (
    <div className="space-y-3">
      {/* Beside the plot rather than only at the top of the page: an aggregate
          watermark that has not reached the last days makes them read as a
          decline instead of as a gap. */}
      {freshness ? <FreshnessBanner freshness={freshness} /> : null}

      {resolved.length === 0 ? (
        <TrendMessage
          description={
            unavailableGroups.length > 1 ? (
              <ul className="space-y-1">
                {unavailableGroups.map((group) => (
                  <li key={group.labels.join(",")}>
                    <strong>{group.labels.join(", ")}:</strong>{" "}
                    {group.description}
                  </li>
                ))}
              </ul>
            ) : (
              (unavailableGroups[0]?.description ??
              describeSeriesUnavailable(undefined))
            )
          }
          plotHeight={plotHeight}
          title="Not available"
        />
      ) : (
        <TrendChart
          ariaLabel={`${view.label}, last ${days} UTC days. Use the arrow keys to read each day.`}
          formatValue={(value) => formatAnalyticsSeriesValue(value, view.kind)}
          kind={view.kind}
          plotHeight={plotHeight}
          revealKey={`${view.id}-${days}`}
          series={resolved}
          tableCaption={`${view.label} by UTC day`}
        />
      )}

      {resolved.length > 0 && unavailableGroups.length > 0 ? (
        <div className="space-y-1 text-[11px] text-muted-foreground leading-4">
          {unavailableGroups.map((group) => (
            <p key={group.labels.join(",")}>
              {group.labels.join(", ")} {group.labels.length > 1 ? "are" : "is"}{" "}
              not drawn. {group.description}
            </p>
          ))}
        </div>
      ) : null}

      {captions.length > 0 ? (
        <p className="text-[11px] text-muted-foreground leading-4">
          {captions.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A failed series, explained where the plot would have been.
 *
 * The refusal case is the one that matters: the reader asked for a filter the
 * daily aggregate cannot carry for this measure, and both halves of that
 * disagreement stay on screen. Dropping the filter would answer a question
 * nobody asked, and dropping the metric would leave the selector pointing at
 * something invisible.
 */
function TrendFailure({
  error,
  filters,
  onFiltersChange,
  onRetry,
  plotHeight,
  scope,
}: {
  error: unknown;
  filters: AnalyticsFilters;
  onFiltersChange?: (filters: AnalyticsFilters) => void;
  onRetry: () => void;
  plotHeight?: number;
  scope: AnalyticsScope;
}) {
  const refusal = describeDimensionRefusal(error);
  if (refusal) {
    const clearable = refusal.dimensions.filter(
      (
        entry
      ): entry is {
        dimension: (typeof CLEARABLE_ANALYTICS_DIMENSIONS)[number];
        label: string;
      } =>
        CLEARABLE_ANALYTICS_DIMENSIONS.some(
          (candidate) => candidate === entry.dimension
        )
    );
    const clear =
      onFiltersChange && clearable.length > 0
        ? () => {
            const next = { ...filters };
            for (const entry of clearable) {
              next[entry.dimension] = undefined;
            }
            onFiltersChange(next);
          }
        : undefined;
    const filterList = refusal.dimensions
      .map((entry) => entry.label)
      .join(" and ");
    // The button is named after what it actually clears, never after the full
    // refusal: promising to clear a dimension this control cannot reach would
    // leave the reader looking at the same refusal after pressing it.
    const clearableList = clearable.map((entry) => entry.label).join(" and ");
    const unclearable = refusal.dimensions.filter(
      (entry) =>
        !CLEARABLE_ANALYTICS_DIMENSIONS.some(
          (candidate) => candidate === entry.dimension
        )
    );
    return (
      <TrendMessage
        action={
          clear ? (
            <Button
              className="h-7 px-2 text-xs"
              onClick={clear}
              size="sm"
              variant="outline"
            >
              Clear the {clearableList.toLowerCase()} filter
            </Button>
          ) : undefined
        }
        description={
          <>
            {refusal.metrics.join(", ") || "This measure"} cannot be filtered by{" "}
            {filterList.toLowerCase()} yet: it is correlated back to the
            presentation that produced it, and the daily aggregate that holds
            that correlation is written without those dimensions. Clear the
            filter to chart it, or choose a measure counted per event.
            {unclearable.length > 0 ? (
              <>
                {" "}
                {unclearable.map((entry) => entry.label).join(" and ")}{" "}
                {unclearable.length > 1 ? "are" : "is"} not cleared here; change{" "}
                {unclearable.length > 1 ? "them" : "it"} in the filter row
                above.
              </>
            ) : null}
          </>
        }
        plotHeight={plotHeight}
        title="Filter and measure disagree"
      />
    );
  }

  // The scope carries the Environment alias as well as its id, which is what a
  // coded recovery link is built from. Describing the fix and then offering no
  // way to reach it is the failure this passes the whole scope to avoid.
  const failure = describeApiError(error, scope);
  if (!failure.retryable && failure.recovery?.href) {
    return (
      <TrendMessage
        action={
          <a
            className="font-semibold text-primary text-xs underline underline-offset-2"
            href={failure.recovery.href}
          >
            {failure.recovery.label}
          </a>
        }
        description={failure.description}
        plotHeight={plotHeight}
        title="Not available"
      />
    );
  }
  return (
    <TrendMessage
      action={
        failure.retryable ? (
          <Button
            className="h-7 px-2 text-xs"
            onClick={onRetry}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        ) : undefined
      }
      description={failure.description}
      plotHeight={plotHeight}
      title="Not available"
    />
  );
}
