/**
 * The geometry a daily trend line needs, with no Mosaic domain in it.
 *
 * These were written for the Project overview chart and are now shared with the
 * Analytics surfaces. They stay separate from the component so the rules a
 * reader depends on — a zero-anchored axis, a line that breaks rather than
 * bridging an unmeasured day, a partial final edge — are one implementation
 * rather than one per surface.
 */

/** One day of a series. `null` is "not measured", never zero. */
export interface TrendPoint {
  date: string;
  /** Present and true on today's point only: the day is still accruing. */
  partial?: boolean;
  value: number | null;
}

/**
 * A series' colour slot, fixed per measure rather than per position.
 *
 * Colour follows the entity: a measure keeps its slot whether it is drawn
 * beside another series or alone, so a reader who learned "purchases is orange"
 * is never contradicted by changing the selector. Slots 1 and 2 are the only
 * pair that can share a plot, and that pair is the one validated for
 * colour-vision separation against both chart surfaces.
 */
export type TrendSeriesSlot = 1 | 2;

/** Counts and rates never share a y-axis, so a plot is one or the other. */
export type TrendValueKind = "count" | "rate";

export interface TrendSegment {
  /** True for the edge that ends on today, whose day is still accruing. */
  partial: boolean;
  points: readonly { index: number; value: number }[];
}

/**
 * Split a series into the runs a line may actually connect.
 *
 * A null value means "not measured", which for a rate is a day with no
 * denominator to divide by. Drawing through it would assert a value that was
 * never observed, so the line breaks there instead. The final edge into a
 * partial day is split off so it can be drawn distinctly: today's number is not
 * comparable with the completed days beside it.
 */
export function splitTrendSegments(
  points: readonly TrendPoint[]
): TrendSegment[] {
  const runs: { index: number; partial: boolean; value: number }[][] = [];
  let run: { index: number; partial: boolean; value: number }[] = [];

  points.forEach((point, index) => {
    if (point.value === null) {
      if (run.length > 0) {
        runs.push(run);
        run = [];
      }
      return;
    }
    run.push({ index, partial: point.partial === true, value: point.value });
  });
  if (run.length > 0) {
    runs.push(run);
  }

  const segments: TrendSegment[] = [];
  for (const entries of runs) {
    const last = entries.at(-1);
    if (!last?.partial) {
      segments.push({ partial: false, points: entries });
      continue;
    }
    if (entries.length >= 2) {
      segments.push({ partial: false, points: entries.slice(0, -1) });
    }
    segments.push({ partial: true, points: entries.slice(-2) });
  }

  return segments;
}

const COUNT_STEPS = [1, 2, 5, 10];
const RATE_STEPS = [1, 2, 2.5, 5, 10];
const TICK_INTERVALS = 4;
const MIN_COUNT_STEP = 1;
const MIN_RATE_STEP = 0.05;
const MAX_RATE = 1;

function niceStep(raw: number, kind: TrendValueKind) {
  const steps = kind === "rate" ? RATE_STEPS : COUNT_STEPS;
  const floor = kind === "rate" ? MIN_RATE_STEP : MIN_COUNT_STEP;
  if (!(raw > 0)) {
    return floor;
  }
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const chosen =
    steps
      .map((multiplier) => multiplier * magnitude)
      .find((step) => step >= raw) ?? 10 * magnitude;
  return Math.max(chosen, floor);
}

export interface TrendAxisScale {
  max: number;
  ticks: number[];
}

/**
 * A zero-anchored y-axis with about four gridlines.
 *
 * Counts always start at zero — a truncated baseline exaggerates every
 * movement — and a window in which nothing happened still gets a real scale so
 * the flat zero line is drawn rather than replaced by an empty state.
 */
export function trendAxisScale(
  maxValue: number,
  kind: TrendValueKind = "count"
): TrendAxisScale {
  const top = Math.max(maxValue, 0);
  const step = niceStep(top / TICK_INTERVALS, kind);
  // The step is sized for about four intervals, but the axis stops at the
  // first one above the data: rounding up to a fixed interval count would
  // leave a window's worth of empty headroom and flatten the movement the
  // chart exists to show.
  const intervals = top > 0 ? Math.ceil(top / step) : TICK_INTERVALS;
  const ticks: number[] = [];
  for (let index = 0; index <= intervals; index += 1) {
    const tick = step * index;
    if (kind === "rate" && tick > MAX_RATE) {
      break;
    }
    ticks.push(tick);
  }
  const last = ticks.at(-1) ?? step;
  return { max: last, ticks };
}

/**
 * Evenly spaced x positions to label, always including the first and last day
 * so the window's own bounds are readable without a tooltip.
 */
export function dateTickIndices(count: number, maxLabels: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (count <= maxLabels) {
    return Array.from({ length: count }, (_, index) => index);
  }
  const stride = (count - 1) / (maxLabels - 1);
  const indices = new Set<number>();
  for (let index = 0; index < maxLabels; index += 1) {
    indices.add(Math.round(index * stride));
  }
  return [...indices].sort((a, b) => a - b);
}

const compactCountFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
});

const axisRateFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  style: "percent",
});

/** Axis ticks are read in a column, so they stay compact and tabular. */
export function formatTrendAxisTick(
  value: number,
  kind: TrendValueKind = "count"
) {
  return kind === "rate"
    ? axisRateFormat.format(value)
    : compactCountFormat.format(value);
}

const dayLabelFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const fullDayLabelFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

export function formatTrendDay(
  date: string,
  style: "full" | "short" = "short"
) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return style === "full"
    ? fullDayLabelFormat.format(parsed)
    : dayLabelFormat.format(parsed);
}
