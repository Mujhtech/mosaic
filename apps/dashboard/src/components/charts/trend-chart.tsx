// biome-ignore-all lint/a11y/noNoninteractiveTabindex: a focusable plot is how a keyboard reader steps through the days without a pointer, and the same values stay in the table below.
// biome-ignore-all lint/a11y/noNoninteractiveElementInteractions: the plot is the interaction surface; its readout is duplicated in the table, so hover and focus enhance rather than gate.

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  dateTickIndices,
  formatTrendAxisTick,
  formatTrendDay,
  splitTrendSegments,
  type TrendPoint,
  type TrendSeriesSlot,
  type TrendValueKind,
  trendAxisScale,
} from "@/components/charts/trend-scale";

const PAD_TOP = 12;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
export const DEFAULT_TREND_PLOT_HEIGHT = 200;
/** A trend read beside a table rather than as the page's subject. */
export const COMPACT_TREND_PLOT_HEIGHT = 108;
const X_AXIS_BAND = 26;
/** Used until the container reports a width, and in non-layout environments. */
const FALLBACK_WIDTH = 720;
const MIN_PLOT_WIDTH = 240;
/** Room one date label needs before its neighbour, at the axis font size. */
const DATE_LABEL_PITCH = 92;
const MIN_DATE_LABELS = 3;
const MAX_DATE_LABELS = 7;
const END_DOT_RADIUS = 4;
const ACTIVE_DOT_RADIUS = 4.5;
const PARTIAL_DASH = "4 3";

/** The drawn height of the frame, so a message or skeleton can match it. */
export function trendFrameHeight(plotHeight = DEFAULT_TREND_PLOT_HEIGHT) {
  return PAD_TOP + plotHeight + X_AXIS_BAND;
}

export interface TrendChartSeries {
  key: string;
  label: string;
  points: readonly TrendPoint[];
  slot: TrendSeriesSlot;
}

export interface TrendChartProps {
  /** The whole plot, described in one sentence for a screen reader. */
  ariaLabel: string;
  /** Prints one value the way its own surface prints it elsewhere. */
  formatValue: (value: number) => string;
  /** Decides the axis shape. Counts and rates never share a plot. */
  kind: TrendValueKind;
  plotHeight?: number;
  /** Replays the reveal when the reader changes what is drawn. */
  revealKey?: string;
  series: readonly TrendChartSeries[];
  tableCaption: string;
}

/**
 * A daily trend line: the plot, its readout, and the table behind it.
 *
 * Everything a reader can be misled by lives here rather than in each caller —
 * the zero-anchored axis, the break on an unmeasured day, the distinct partial
 * edge for a day that is still accruing, the fixed colour slots, and the table
 * that carries the same numbers for a reader who is not using a pointer. A
 * caller supplies data, labels, and its own value formatting; it does not
 * re-decide any of those rules.
 */
export function TrendChart({
  ariaLabel,
  formatValue,
  kind,
  plotHeight = DEFAULT_TREND_PLOT_HEIGHT,
  revealKey,
  series,
  tableCaption,
}: TrendChartProps) {
  const { ref, width } = useContainerWidth();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const tableId = useId();
  const svgHeight = trendFrameHeight(plotHeight);

  const dates = useMemo(
    () => series[0]?.points.map((point) => point.date) ?? [],
    [series]
  );
  const count = dates.length;
  const plotWidth = Math.max(width - PAD_LEFT - PAD_RIGHT, MIN_PLOT_WIDTH);
  const svgWidth = plotWidth + PAD_LEFT + PAD_RIGHT;

  const maxValue = series.reduce((outer, entry) => {
    const inner = entry.points.reduce(
      (accumulator, point) => Math.max(accumulator, point.value ?? 0),
      0
    );
    return Math.max(outer, inner);
  }, 0);
  const scale = trendAxisScale(maxValue, kind);

  const x = (index: number) =>
    PAD_LEFT + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
  const y = (value: number) =>
    PAD_TOP +
    plotHeight -
    (scale.max === 0 ? 0 : value / scale.max) * plotHeight;

  // Labels thin out with the container rather than overlapping on a phone.
  const labelBudget = Math.min(
    MAX_DATE_LABELS,
    Math.max(MIN_DATE_LABELS, Math.floor(plotWidth / DATE_LABEL_PITCH))
  );
  const labelIndices = dateTickIndices(count, labelBudget);
  const active =
    activeIndex !== null && activeIndex < count ? activeIndex : null;

  const pickIndex = (clientX: number, element: SVGSVGElement) => {
    const rect = element.getBoundingClientRect();
    const offset = clientX - rect.left - PAD_LEFT;
    const ratio = plotWidth === 0 ? 0 : offset / plotWidth;
    const index = Math.round(ratio * Math.max(count - 1, 0));
    return Math.min(Math.max(index, 0), Math.max(count - 1, 0));
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    setActiveIndex(pickIndex(event.clientX, event.currentTarget));
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const current = active ?? count - 1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex(Math.min(current + 1, count - 1));
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex(Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(count - 1);
      return;
    }
    if (event.key === "Escape") {
      setActiveIndex(null);
    }
  };

  const readout =
    active === null
      ? null
      : describeReadout(active, dates, series, formatValue);

  return (
    <div className="relative" ref={ref}>
      <svg
        aria-describedby={tableId}
        aria-label={ariaLabel}
        className="w-full touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        height={svgHeight}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={onKeyDown}
        onPointerLeave={() => setActiveIndex(null)}
        onPointerMove={onPointerMove}
        role="img"
        tabIndex={0}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width={svgWidth}
      >
        <g className="text-border">
          {scale.ticks.map((tick) => (
            <line
              key={tick}
              stroke="currentColor"
              strokeWidth={1}
              x1={PAD_LEFT}
              x2={PAD_LEFT + plotWidth}
              y1={y(tick)}
              y2={y(tick)}
            />
          ))}
        </g>

        <g
          className="fill-muted-foreground text-[10px]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {scale.ticks.map((tick) => (
            <text
              dominantBaseline="middle"
              key={tick}
              textAnchor="end"
              x={PAD_LEFT - 8}
              y={y(tick)}
            >
              {formatTrendAxisTick(tick, kind)}
            </text>
          ))}
          {labelIndices.flatMap((index) => {
            const date = dates[index];
            return date
              ? [
                  <text
                    key={date}
                    textAnchor={xAnchor(index, count)}
                    x={x(index)}
                    y={PAD_TOP + plotHeight + 16}
                  >
                    {formatTrendDay(date)}
                  </text>,
                ]
              : [];
          })}
        </g>

        {active === null ? null : (
          <line
            className="text-muted-foreground/50"
            stroke="currentColor"
            strokeWidth={1}
            x1={x(active)}
            x2={x(active)}
            y1={PAD_TOP}
            y2={PAD_TOP + plotHeight}
          />
        )}

        <g className="mosaic-chart-reveal" key={revealKey}>
          {series.map((entry) => {
            const segments = splitTrendSegments(entry.points);
            const color = seriesColor(entry.slot);
            const last = lastMeasured(entry.points);
            const activeValue =
              active === null ? null : (entry.points[active]?.value ?? null);
            return (
              <g key={entry.key} style={{ color }}>
                {series.length === 1 && segments.length > 0 ? (
                  <path
                    d={areaPath(segments, x, y, PAD_TOP + plotHeight)}
                    fill="currentColor"
                    opacity={0.1}
                  />
                ) : null}
                {segments.map((segment) => (
                  <path
                    d={linePath(segment.points, x, y)}
                    data-partial={segment.partial ? "true" : "false"}
                    data-series={entry.key}
                    data-testid="trend-segment"
                    fill="none"
                    key={`${entry.key}-${segment.partial}-${segment.points[0]?.index}`}
                    stroke="currentColor"
                    strokeDasharray={segment.partial ? PARTIAL_DASH : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                  />
                ))}
                {last ? (
                  <circle
                    className="stroke-card"
                    cx={x(last.index)}
                    cy={y(last.value)}
                    data-partial={last.partial ? "true" : "false"}
                    data-series={entry.key}
                    data-testid="trend-end-dot"
                    fill={last.partial ? "var(--card)" : "currentColor"}
                    r={END_DOT_RADIUS}
                    stroke={last.partial ? "currentColor" : "var(--card)"}
                    strokeWidth={2}
                  />
                ) : null}
                {active !== null && activeValue !== null ? (
                  <circle
                    cx={x(active)}
                    cy={y(activeValue)}
                    fill="currentColor"
                    r={ACTIVE_DOT_RADIUS}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {readout ? (
        <TrendTooltip
          entries={readout.entries}
          left={x(active ?? 0)}
          title={readout.title}
          width={svgWidth}
        />
      ) : null}

      <output aria-live="polite" className="sr-only">
        {readout
          ? `${readout.title}. ${readout.entries
              .map((entry) => `${entry.label} ${entry.value}`)
              .join(", ")}`
          : ""}
      </output>

      {series.length > 1 ? <TrendLegend series={series} /> : null}

      <TrendDataTable
        caption={tableCaption}
        dates={dates}
        formatValue={formatValue}
        id={tableId}
        series={series}
      />
    </div>
  );
}

/**
 * A blank frame the height of the plot, so an unreadable series never collapses
 * the card and never gets mistaken for a flat line at zero.
 */
export function TrendMessage({
  action,
  description,
  plotHeight = DEFAULT_TREND_PLOT_HEIGHT,
  title,
}: {
  action?: ReactNode;
  description: ReactNode;
  plotHeight?: number;
  title: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center"
      style={{ minHeight: trendFrameHeight(plotHeight) }}
    >
      <p className="font-medium text-muted-foreground text-sm">{title}</p>
      <div className="max-w-md text-[11px] text-muted-foreground leading-4">
        {description}
      </div>
      {action}
    </div>
  );
}

export function trendSeriesColor(slot: TrendSeriesSlot) {
  return seriesColor(slot);
}

function seriesColor(slot: TrendSeriesSlot) {
  return `var(--mosaic-chart-series-${slot})`;
}

/** The measured width of the plot area, or a usable default before layout. */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) {
        setWidth(measured);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function xAnchor(index: number, count: number) {
  if (index === 0) {
    return "start" as const;
  }
  if (index === count - 1) {
    return "end" as const;
  }
  return "middle" as const;
}

function linePath(
  points: readonly { index: number; value: number }[],
  x: (index: number) => number,
  y: (value: number) => number
) {
  return points
    .map(
      (point, position) =>
        `${position === 0 ? "M" : "L"}${x(point.index).toFixed(2)} ${y(point.value).toFixed(2)}`
    )
    .join(" ");
}

function areaPath(
  segments: readonly { points: readonly { index: number; value: number }[] }[],
  x: (index: number) => number,
  y: (value: number) => number,
  baseline: number
) {
  return segments
    .filter((segment) => segment.points.length > 1)
    .map((segment) => {
      const [first] = segment.points;
      const last = segment.points.at(-1);
      if (!(first && last)) {
        return "";
      }
      return `${linePath(segment.points, x, y)} L${x(last.index).toFixed(2)} ${baseline} L${x(first.index).toFixed(2)} ${baseline} Z`;
    })
    .join(" ");
}

function lastMeasured(points: readonly TrendPoint[]) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point && point.value !== null) {
      return { index, partial: point.partial === true, value: point.value };
    }
  }
  return null;
}

/** Shown for a day whose value the API reported as null. */
const NOT_MEASURED = "Not measured";

function describeReadout(
  index: number,
  dates: readonly string[],
  series: readonly TrendChartSeries[],
  formatValue: (value: number) => string
) {
  const date = dates[index];
  if (!date) {
    return null;
  }
  const partial = series.some((entry) => entry.points[index]?.partial === true);
  return {
    entries: series.map((entry) => {
      const value = entry.points[index]?.value ?? null;
      return {
        label: entry.label,
        slot: entry.slot,
        value: value === null ? NOT_MEASURED : formatValue(value),
      };
    }),
    title: `${formatTrendDay(date, "full")}${partial ? " · still accruing" : ""}`,
  };
}

function TrendTooltip({
  entries,
  left,
  title,
  width,
}: {
  entries: readonly {
    label: string;
    slot: TrendSeriesSlot;
    value: string;
  }[];
  left: number;
  title: string;
  width: number;
}) {
  const ratio = width === 0 ? 0 : left / width;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border bg-popover px-2.5 py-2 text-popover-foreground text-xs shadow-sm"
      style={{
        left: `${ratio * 100}%`,
        transform: `translateX(${ratio > 0.7 ? "-100%" : "-50%"})`,
      }}
    >
      <p className="mb-1 text-[11px] text-muted-foreground">{title}</p>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li className="flex items-center gap-1.5" key={entry.label}>
            <span
              className="h-0.5 w-3 rounded-full"
              style={{ background: seriesColor(entry.slot) }}
            />
            <span className="font-semibold">{entry.value}</span>
            <span className="text-muted-foreground">{entry.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendLegend({ series }: { series: readonly TrendChartSeries[] }) {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-3">
      {series.map((entry) => (
        <li
          className="flex items-center gap-1.5 text-muted-foreground text-xs"
          key={entry.key}
        >
          <span
            className="h-0.5 w-4 rounded-full"
            style={{ background: seriesColor(entry.slot) }}
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The same numbers as the plot, in the form a screen reader can read and a
 * pointer never has to hunt for. The chart's tooltip enhances this; it does not
 * gate it.
 */
function TrendDataTable({
  caption,
  dates,
  formatValue,
  id,
  series,
}: {
  caption: string;
  dates: readonly string[];
  formatValue: (value: number) => string;
  id: string;
  series: readonly TrendChartSeries[];
}) {
  return (
    <table className="sr-only" id={id}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Day</th>
          {series.map((entry) => (
            <th key={entry.key} scope="col">
              {entry.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dates.map((date, index) => (
          <tr key={date}>
            <th scope="row">
              {formatTrendDay(date, "full")}
              {series.some((entry) => entry.points[index]?.partial === true)
                ? " (still accruing)"
                : ""}
            </th>
            {series.map((entry) => {
              const value = entry.points[index]?.value ?? null;
              return (
                <td key={entry.key}>
                  {value === null ? NOT_MEASURED : formatValue(value)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
