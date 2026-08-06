import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";

import { ChartChip } from "@/components/charts/chart-chip";
import {
  TrendChart,
  type TrendChartSeries,
  TrendMessage,
  trendFrameHeight,
} from "@/components/charts/trend-chart";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { overviewMetricsSeriesQueryOptions } from "@/features/projects/queries/overview-metrics-series-query";
import {
  describeOverviewUnavailable,
  formatOverviewValue,
  type OverviewRecoveryTarget,
} from "@/features/projects/types/overview-metrics";
import {
  DEFAULT_OVERVIEW_TREND_RANGE,
  OVERVIEW_TREND_RANGES,
  OVERVIEW_TREND_VIEWS,
  type OverviewTrendRange,
  type OverviewTrendView,
} from "@/features/projects/types/overview-series";
import type { OverviewSeries } from "@/generated/api";
import { describeApiError } from "@/lib/api/errors";

const PARTIAL_CAPTION = "Today is still accruing.";

interface UnavailableSeries {
  label: string;
  reason: OverviewSeries["reason"];
}

/**
 * The unavailable series that share one reason, so each distinct reason is
 * stated once and none is dropped. Reporting only the first series' reason
 * would attribute every gap to whichever measure happened to sort first.
 */
interface UnavailableGroup {
  copy: ReturnType<typeof describeOverviewUnavailable>;
  labels: string[];
}

function groupUnavailable(entries: UnavailableSeries[]): UnavailableGroup[] {
  const groups = new Map<string, UnavailableGroup>();
  for (const entry of entries) {
    const key = entry.reason ?? "unreported";
    const group = groups.get(key);
    if (group) {
      group.labels.push(entry.label);
      continue;
    }
    groups.set(key, {
      copy: describeOverviewUnavailable(entry.reason),
      labels: [entry.label],
    });
  }
  return [...groups.values()];
}

export interface OverviewTrendChartProps {
  environmentId?: string;
  /** The Environment as an address names it, which a recovery link needs. */
  environmentKey?: string;
  organizationId: string;
  projectId: string;
  renderRecovery?: (target: OverviewRecoveryTarget, label: string) => ReactNode;
}

/**
 * How the Environment moved over the selected window.
 *
 * The tiles above answer "what is happening now"; this answers "is that
 * normal", which no single number can. It keeps its own window control because
 * its scope genuinely differs from the tiles' UTC day rather than because each
 * card is allowed its own filters.
 */
export function OverviewTrendChart({
  environmentId,
  environmentKey,
  organizationId,
  projectId,
  renderRecovery,
}: OverviewTrendChartProps) {
  const [viewId, setViewId] = useState(OVERVIEW_TREND_VIEWS[0].id);
  const [days, setDays] = useState<OverviewTrendRange>(
    DEFAULT_OVERVIEW_TREND_RANGE
  );
  const view =
    OVERVIEW_TREND_VIEWS.find((candidate) => candidate.id === viewId) ??
    OVERVIEW_TREND_VIEWS[0];

  const series = useQuery({
    ...overviewMetricsSeriesQueryOptions(projectId, environmentId ?? "", days),
    enabled: Boolean(environmentId),
  });

  const isPending = series.isPending || !environmentId;
  const failure = series.error
    ? describeApiError(series.error, {
        environmentId,
        ...(environmentKey ? { environmentKey } : {}),
        organizationId,
        projectId,
      })
    : null;

  const resolved = useMemo<TrendChartSeries[]>(() => {
    if (!series.data) {
      return [];
    }
    return view.series.flatMap((member) => {
      const value = series.data.metrics[member.key];
      if (!(value.available && value.points)) {
        return [];
      }
      return [
        {
          key: member.key,
          label: member.label,
          points: value.points,
          slot: member.slot,
        },
      ];
    });
  }, [series.data, view]);

  const unavailable = useMemo<UnavailableSeries[]>(() => {
    if (!series.data) {
      return [];
    }
    return view.series.flatMap((member) => {
      const value = series.data.metrics[member.key];
      return value.available && value.points
        ? []
        : [{ label: member.label, reason: value.reason }];
    });
  }, [series.data, view]);

  const hasPartial = resolved.some((entry) =>
    entry.points.some((point) => point.partial === true)
  );
  const captions = [...view.captions, ...(hasPartial ? [PARTIAL_CAPTION] : [])];

  const retry = () => {
    series.refetch();
  };

  return (
    <figure className="m-0 space-y-3 rounded-lg border bg-card p-4">
      <figcaption className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold text-sm">Trend · UTC</h3>
          <p className="text-muted-foreground text-xs">
            Daily {view.label.toLowerCase()} over the last {days} UTC days.
          </p>
        </div>
        <TrendControls
          days={days}
          onDaysChange={setDays}
          onViewChange={setViewId}
          view={view}
        />
      </figcaption>

      {failure ? (
        <TrendMessage
          action={
            <Button onClick={retry} size="sm" variant="outline">
              Retry loading the trend
            </Button>
          }
          description={failure.description}
          title="Not available"
        />
      ) : (
        <TrendBody
          days={days}
          isPending={isPending}
          onRetry={retry}
          renderRecovery={renderRecovery}
          resolved={resolved}
          unavailable={unavailable}
          view={view}
        />
      )}

      {captions.length > 0 ? (
        <p className="text-[11px] text-muted-foreground leading-4">
          {captions.join(" ")}
        </p>
      ) : null}
    </figure>
  );
}

function TrendBody({
  days,
  isPending,
  onRetry,
  renderRecovery,
  resolved,
  unavailable,
  view,
}: {
  days: number;
  isPending: boolean;
  onRetry: () => void;
  renderRecovery?: OverviewTrendChartProps["renderRecovery"];
  resolved: TrendChartSeries[];
  unavailable: UnavailableSeries[];
  view: OverviewTrendView;
}) {
  if (isPending) {
    return (
      <Skeleton
        aria-label={`Loading the ${view.label.toLowerCase()} trend`}
        className="w-full"
        style={{ height: trendFrameHeight() }}
      />
    );
  }

  if (resolved.length === 0) {
    const groups = groupUnavailable(unavailable);
    const single = groups.length <= 1;
    const copy = groups[0]?.copy ?? describeOverviewUnavailable(undefined);
    const recoveries = groups.flatMap((group) =>
      group.copy.recoveryTarget && group.copy.recoveryLabel && renderRecovery
        ? [
            <span key={group.copy.recoveryTarget}>
              {renderRecovery(
                group.copy.recoveryTarget,
                group.copy.recoveryLabel
              )}
            </span>,
          ]
        : []
    );
    return (
      <TrendMessage
        action={
          groups.some((group) => group.copy.retryable) ? (
            <Button
              className="h-7 px-2 text-xs"
              onClick={onRetry}
              size="sm"
              variant="outline"
            >
              Retry
            </Button>
          ) : (
            <span className="flex flex-wrap items-center gap-3">
              {recoveries}
            </span>
          )
        }
        description={
          single ? (
            copy.description
          ) : (
            // Several measures can be missing for different reasons at once;
            // showing only the first would misattribute the others.
            <ul className="space-y-1">
              {groups.map((group) => (
                <li key={group.labels.join(",")}>
                  <strong>{group.labels.join(", ")}:</strong>{" "}
                  {group.copy.description}
                </li>
              ))}
            </ul>
          )
        }
        title="Not available"
      />
    );
  }

  return (
    <>
      <TrendChart
        ariaLabel={`${view.label}, last ${days} UTC days. Use the arrow keys to read each day.`}
        formatValue={(value) => formatOverviewValue(value, view.kind)}
        kind={view.kind}
        revealKey={`${view.id}-${days}`}
        series={resolved}
        tableCaption={`${view.label} by UTC day`}
      />
      {unavailable.length > 0 ? (
        <div className="space-y-1 text-[11px] text-muted-foreground leading-4">
          {groupUnavailable(unavailable).map((group) => (
            <p key={group.labels.join(",")}>
              {group.labels.join(", ")} could not be read for this window, so{" "}
              {group.labels.length > 1 ? "they are" : "it is"} not drawn.{" "}
              {group.copy.description}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}

function TrendControls({
  days,
  onDaysChange,
  onViewChange,
  view,
}: {
  days: OverviewTrendRange;
  onDaysChange: (days: OverviewTrendRange) => void;
  onViewChange: (viewId: string) => void;
  view: OverviewTrendView;
}) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="sr-only">Measure to chart</legend>
        {OVERVIEW_TREND_VIEWS.map((candidate) => (
          <ChartChip
            key={candidate.id}
            label={candidate.label}
            onSelect={() => onViewChange(candidate.id)}
            selected={candidate.id === view.id}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="sr-only">Window length</legend>
        {OVERVIEW_TREND_RANGES.map((range) => (
          <ChartChip
            key={range}
            label={`${range} days`}
            onSelect={() => onDaysChange(range)}
            selected={range === days}
          />
        ))}
      </fieldset>
    </div>
  );
}
