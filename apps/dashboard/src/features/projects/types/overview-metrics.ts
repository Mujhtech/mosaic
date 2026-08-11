import type {
  Environment,
  OverviewMetric,
  OverviewWindow,
} from "@/generated/api";
import { type ApiCodeDescription, describeApiCode } from "@/lib/api/errors";

/**
 * How a tile prints its number, and what a change in it means.
 *
 * `count` is a whole population or event count; `rate` is the ratio between 0
 * and 1 the API sends for conversion, which is shown as a percentage and whose
 * change is expressed in percentage points rather than as a percentage of a
 * percentage.
 */
export type OverviewMetricKind = "count" | "rate";

export interface OverviewDelta {
  /** Signed difference, already in the unit the tile prints. */
  amount: number;
  direction: "down" | "flat" | "up";
}

/**
 * The Environment the overview reports on when the address does not name one.
 *
 * Production first: the number an operator opens this page to see is the live
 * one, and showing a sandbox population under a Project title is the more
 * expensive mistake. A remembered choice still outranks the preference, so the
 * page does not argue with a selection the operator made themselves.
 */
export function defaultOverviewEnvironment(
  environments: readonly Environment[],
  rememberedId?: string
): Environment | undefined {
  return (
    environments.find((environment) => environment.id === rememberedId) ??
    environments.find((environment) => environment.key === "production") ??
    environments.find((environment) => environment.key === "staging") ??
    environments[0]
  );
}

/**
 * The change against yesterday, or null when there is nothing honest to say.
 *
 * A tri-state metric that could not be read carries no value at all, so a
 * comparison against it would be a comparison against an assumption. Both sides
 * must be available before a delta exists; one unreadable side means the tile
 * shows today's number and no trend, never a change measured from zero.
 */
export function overviewDelta(
  today: OverviewMetric,
  yesterday: OverviewMetric,
  kind: OverviewMetricKind = "count"
): OverviewDelta | null {
  if (!(today.available && yesterday.available)) {
    return null;
  }
  if (today.value === null || yesterday.value === null) {
    return null;
  }

  const raw = today.value - yesterday.value;
  const amount = kind === "rate" ? raw * 100 : raw;
  const direction = (() => {
    if (amount > 0) {
      return "up" as const;
    }
    if (amount < 0) {
      return "down" as const;
    }
    return "flat" as const;
  })();

  return { amount, direction };
}

const countFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

const rateFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  style: "percent",
});

const pointsFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

export function formatOverviewValue(
  value: number,
  kind: OverviewMetricKind = "count"
) {
  return kind === "rate" ? rateFormat.format(value) : countFormat.format(value);
}

/** Signed change, in the tile's own unit. Percentage points for a rate. */
export function formatOverviewDelta(
  delta: OverviewDelta,
  kind: OverviewMetricKind = "count"
) {
  const magnitude =
    kind === "rate"
      ? `${pointsFormat.format(Math.abs(delta.amount))} pts`
      : countFormat.format(Math.abs(delta.amount));

  if (delta.direction === "flat") {
    return kind === "rate" ? `${pointsFormat.format(0)} pts` : "No change";
  }
  return `${delta.direction === "up" ? "+" : "−"}${magnitude}`;
}

export type OverviewRecoveryTarget = "billing-setup" | "environment-settings";

/**
 * Whether the absence is a problem at all.
 *
 * `not_reported` is the ordinary state of an Environment nobody has used yet:
 * there is no number because there was nothing to count, not because anything
 * failed. Everything else is a condition the operator either chose or must act
 * on, so it reads as an interruption.
 */
export type OverviewUnavailableTone = "not_reported" | "unavailable";

export interface OverviewUnavailableCopy extends ApiCodeDescription {
  /** The short state name the tile prints where the number would be. */
  headline: string;
  /** Where the operator resolves it, or undefined when only a retry applies. */
  recoveryTarget?: OverviewRecoveryTarget;
  retryable: boolean;
  tone: OverviewUnavailableTone;
}

const GENERIC_UNAVAILABLE =
  "Mosaic could not read the source for this metric. The failure is recorded server-side; retry to read it again.";

/**
 * A rate with no denominator, which is a reading rather than a fault.
 *
 * Nobody was shown a paywall in this window, so there is no ratio to state.
 * Printing 0% would claim every viewer declined, and offering a retry or a
 * settings link would suggest something is broken. Neither is true on a new or
 * low-traffic Environment, which is exactly when this appears.
 */
const NOT_MEASURED =
  "No paywall views in this window, so there is no rate to measure yet. Numbers appear once the Environment sees traffic.";

/**
 * Why a metric is missing, in the same words the error path uses.
 *
 * `analytics_collection_disabled` and `billing_disabled` are choices an
 * operator made, so they get the configuration explanation and a pointer to the
 * screen that reverses it. `not_measured` is a normal empty window and gets
 * neither. `metric_unavailable` is a read that failed, so it gets a retry
 * instead of a settings link — sending someone to settings for a transient
 * failure would be a false accusation.
 */
export function describeOverviewUnavailable(
  reason: OverviewMetric["reason"]
): OverviewUnavailableCopy {
  if (reason === "analytics_collection_disabled") {
    const copy = describeApiCode(reason);
    return {
      description: copy?.description ?? GENERIC_UNAVAILABLE,
      headline: "Not available",
      ...(copy?.recoveryLabel ? { recoveryLabel: copy.recoveryLabel } : {}),
      recoveryTarget: "environment-settings",
      retryable: false,
      tone: "unavailable",
    };
  }

  if (reason === "billing_disabled") {
    const copy = describeApiCode(reason);
    return {
      description: copy?.description ?? GENERIC_UNAVAILABLE,
      headline: "Not available",
      ...(copy?.recoveryLabel ? { recoveryLabel: copy.recoveryLabel } : {}),
      recoveryTarget: "billing-setup",
      retryable: false,
      tone: "unavailable",
    };
  }

  if (reason === "not_measured") {
    return {
      description: NOT_MEASURED,
      headline: "Not measured",
      retryable: false,
      tone: "not_reported",
    };
  }

  return {
    description: GENERIC_UNAVAILABLE,
    headline: "Not available",
    retryable: true,
    tone: "unavailable",
  };
}

const utcDayFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

const utcTimeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/**
 * The day the response actually measured, never the reader's own clock. The
 * window's `to` is the request instant rather than midnight, so it is stated:
 * the day is still in progress and today's number is not yet final.
 */
export function describeOverviewWindow(window: OverviewWindow) {
  const from = new Date(window.from);
  const to = new Date(window.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return;
  }
  return `${utcDayFormat.format(from)}, ${utcTimeFormat.format(from)}–${utcTimeFormat.format(to)} ${window.timezone}`;
}
