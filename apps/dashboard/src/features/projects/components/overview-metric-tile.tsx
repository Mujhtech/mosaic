import { ArrowDownIcon } from "@phosphor-icons/react/dist/ssr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { MinusIcon } from "@phosphor-icons/react/dist/ssr/Minus";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeOverviewUnavailable,
  formatOverviewDelta,
  formatOverviewValue,
  type OverviewMetricKind,
  type OverviewRecoveryTarget,
  overviewDelta,
} from "@/features/projects/types/overview-metrics";
import type { OverviewMetric } from "@/generated/api";

export interface OverviewMetricTileProps {
  /** Standing authority note, such as the client-observed purchase caveat. */
  caption?: string;
  /** Yesterday's counterpart. Omitted for standing totals, which have no window. */
  comparison?: OverviewMetric;
  isPending?: boolean;
  kind?: OverviewMetricKind;
  label: string;
  metric?: OverviewMetric;
  onRetry?: () => void;
  /**
   * The destination that resolves a configuration reason. Supplied by the page
   * because only it holds the routing scope; the tile owns which one applies.
   */
  renderRecovery?: (target: OverviewRecoveryTarget, label: string) => ReactNode;
}

const DELTA_ICON = {
  down: ArrowDownIcon,
  flat: MinusIcon,
  up: ArrowUpIcon,
} as const;

/**
 * Direction is spelled as well as coloured. Green-up alone fails for a
 * colourblind reader and in forced-colors mode, so the arrow and the signed
 * amount carry the meaning and the colour only reinforces it.
 */
const DELTA_TONE = {
  down: "text-red-700 dark:text-red-400",
  flat: "text-muted-foreground",
  up: "text-emerald-700 dark:text-emerald-400",
} as const;

/**
 * One number on the Project overview, in one of three states.
 *
 * The states are deliberately not interchangeable. A metric still loading shows
 * a skeleton, a metric that could not be read says so in words, and a metric
 * that was read shows its number — including zero. Rendering an unreadable
 * source as 0 would be a claim Mosaic cannot support, and it is exactly the
 * mistake the API's tri-state shape exists to prevent.
 */
export function OverviewMetricTile({
  caption,
  comparison,
  isPending = false,
  kind = "count",
  label,
  metric,
  onRetry,
  renderRecovery,
}: OverviewMetricTileProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-4">
      <dt className="font-medium text-muted-foreground text-xs">{label}</dt>
      <dd className="flex flex-1 flex-col gap-1.5">
        <OverviewMetricBody
          comparison={comparison}
          isPending={isPending}
          kind={kind}
          label={label}
          metric={metric}
          onRetry={onRetry}
          renderRecovery={renderRecovery}
        />
        {caption ? (
          <p className="text-[11px] text-muted-foreground leading-4">
            {caption}
          </p>
        ) : null}
      </dd>
    </div>
  );
}

function OverviewMetricBody({
  comparison,
  isPending,
  kind,
  label,
  metric,
  onRetry,
  renderRecovery,
}: Required<Pick<OverviewMetricTileProps, "isPending" | "kind" | "label">> &
  Pick<
    OverviewMetricTileProps,
    "comparison" | "metric" | "onRetry" | "renderRecovery"
  >) {
  if (isPending || !metric) {
    return (
      <>
        <Skeleton aria-label={`Loading ${label}`} className="h-8 w-20" />
        <Skeleton className="h-4 w-24" />
      </>
    );
  }

  if (!metric.available || metric.value === null) {
    return (
      <OverviewMetricUnavailable
        metric={metric}
        onRetry={onRetry}
        renderRecovery={renderRecovery}
      />
    );
  }

  const delta = comparison ? overviewDelta(metric, comparison, kind) : null;
  const DeltaIcon = delta ? DELTA_ICON[delta.direction] : null;

  return (
    <>
      <p className="font-semibold text-2xl tracking-tight">
        {formatOverviewValue(metric.value, kind)}
      </p>
      {delta && DeltaIcon ? (
        <p
          className={`flex items-center gap-1 text-xs ${DELTA_TONE[delta.direction]}`}
        >
          <DeltaIcon aria-hidden className="size-3.5" />
          <span>{formatOverviewDelta(delta, kind)}</span>
          <span className="text-muted-foreground">vs yesterday</span>
        </p>
      ) : null}
    </>
  );
}

function OverviewMetricUnavailable({
  metric,
  onRetry,
  renderRecovery,
}: {
  metric: OverviewMetric;
  onRetry?: () => void;
  renderRecovery?: OverviewMetricTileProps["renderRecovery"];
}) {
  const copy = describeOverviewUnavailable(metric.reason);
  const recovery =
    copy.recoveryTarget && copy.recoveryLabel && renderRecovery
      ? renderRecovery(copy.recoveryTarget, copy.recoveryLabel)
      : null;

  // A window that measured nothing is not a fault, so it does not borrow the
  // interrupted look: no emphasis, no retry, no settings link. It still says so
  // in words rather than printing a number, because "0%" would be a claim.
  const isNotReported = copy.tone === "not_reported";

  return (
    <>
      <p
        className={
          isNotReported
            ? "font-normal text-lg text-muted-foreground"
            : "font-medium text-foreground text-sm"
        }
      >
        {copy.headline}
      </p>
      <p className="text-[11px] text-muted-foreground leading-4">
        {copy.description}
      </p>
      {recovery}
      {copy.retryable && onRetry ? (
        <Button
          className="h-7 self-start px-2 text-xs"
          onClick={onRetry}
          size="sm"
          variant="outline"
        >
          Retry
        </Button>
      ) : null}
    </>
  );
}
