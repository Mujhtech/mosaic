import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  BILLING_BOUNDARY_NOTE,
  formatBillingTimestamp,
  providerLabel,
  storeEnvironmentLabel,
} from "@/features/billing-ledger/types/billing-vocabulary";
import { ScopeBadge } from "@/features/orgs/components/workspace-page";

/**
 * Chrome shared by every Mosaic Billing surface across the three billing
 * features. It exists so the phase boundary and the Mosaic/Store Environment
 * distinction are stated identically everywhere instead of being re-worded per
 * page.
 */

export function BillingBoundaryNote({ children }: { children?: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-muted-foreground text-xs leading-5">
      <InfoIcon aria-hidden className="mt-0.5 shrink-0" size={14} />
      <span>
        {BILLING_BOUNDARY_NOTE}
        {children ? <> {children}</> : null}
      </span>
    </p>
  );
}

/**
 * The two Environments always render as two separately labelled badges. Merging
 * them into one "environment" chip is the single most consequential mistake
 * this surface can make, because sandbox facts would become indistinguishable
 * from production ones.
 */
export function EnvironmentBadges({
  mosaicEnvironmentName,
  storeEnvironment,
}: {
  mosaicEnvironmentName: string;
  storeEnvironment: string | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ScopeBadge>
        <span className="mr-1 text-muted-foreground/80">
          Mosaic Environment:
        </span>
        {mosaicEnvironmentName}
      </ScopeBadge>
      <ScopeBadge>
        <span className="mr-1 text-muted-foreground/80">
          Store Environment:
        </span>
        {storeEnvironmentLabel(storeEnvironment)}
      </ScopeBadge>
    </div>
  );
}

export function ProviderBadge({ provider }: { provider: string | undefined }) {
  return <ScopeBadge>{providerLabel(provider)}</ScopeBadge>;
}

/**
 * A status treatment that is always text-first. Colour is a secondary signal,
 * never the only one.
 */
export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "attention" | "negative" | "neutral" | "positive";
}) {
  const toneClass = {
    attention:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    negative: "border-destructive/35 bg-destructive/10 text-destructive",
    neutral: "border-border bg-muted/55 text-muted-foreground",
    positive: "border-primary/35 bg-primary/10 text-primary",
  }[tone];

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 font-medium text-xs ${toneClass}`}
    >
      {label}
    </span>
  );
}

/** Two timestamps, always labelled, always UTC, raw ISO available on hover. */
export function DualTimestamps({
  occurredAt,
  recordedAt,
}: {
  occurredAt: string | undefined;
  recordedAt: string | undefined;
}) {
  return (
    <div className="text-xs">
      <p title={occurredAt}>
        <span className="text-muted-foreground">Occurred at </span>
        {formatBillingTimestamp(occurredAt)}
      </p>
      <p className="mt-0.5" title={recordedAt}>
        <span className="text-muted-foreground">Recorded at </span>
        {formatBillingTimestamp(recordedAt)}
      </p>
    </div>
  );
}

/**
 * Forward paging over a keyset-paged billing list.
 *
 * Extracted from the 9A transaction ledger, where it was rendered beside every
 * branch including the filtered-empty one. That placement is the point: several
 * filters narrow the loaded page only, so "nothing matched here" must still
 * offer a way to look at the next page rather than making the operator discard
 * their filter to escape.
 *
 * The customer, conflict, and restore lists page the same way, so the control
 * lives in billing chrome rather than being reimplemented per feature.
 */
export function LedgerPaging({
  cursor,
  endLabel = "End of the list for these filters.",
  nextCursor,
  onCursorChange,
}: {
  cursor: string | undefined;
  endLabel?: string;
  nextCursor: string | undefined;
  onCursorChange: (cursor: string | undefined) => void;
}) {
  if (!(cursor || nextCursor)) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {cursor ? (
        <Button
          onClick={() => onCursorChange(undefined)}
          size="sm"
          type="button"
          variant="outline"
        >
          First page
        </Button>
      ) : null}
      {nextCursor ? (
        <Button
          onClick={() => onCursorChange(nextCursor)}
          size="sm"
          type="button"
          variant="outline"
        >
          Next page
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">{endLabel}</p>
      )}
    </div>
  );
}

export function DefinitionRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-2 last:border-b-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="break-all text-right font-medium text-sm">{value}</dd>
    </div>
  );
}
