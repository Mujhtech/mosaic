import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info"
import type { ReactNode } from "react"

import { ScopeBadge } from "@/features/organizations/components/workspace-page"
import {
  BILLING_BOUNDARY_NOTE,
  formatBillingTimestamp,
  providerLabel,
  storeEnvironmentLabel,
} from "@/features/billing-ledger/types/billing-vocabulary"

/**
 * Chrome shared by every Mosaic Billing surface across the three billing
 * features. It exists so the phase boundary and the Mosaic/Store Environment
 * distinction are stated identically everywhere instead of being re-worded per
 * page.
 */

export function BillingBoundaryNote({ children }: { children?: ReactNode }) {
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-xs leading-5">
      <InfoIcon aria-hidden className="mt-0.5 shrink-0" size={14} />
      <span>
        {BILLING_BOUNDARY_NOTE}
        {children ? <> {children}</> : null}
      </span>
    </p>
  )
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
  mosaicEnvironmentName: string
  storeEnvironment: string | undefined
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ScopeBadge>
        <span className="text-muted-foreground/80 mr-1">Mosaic Environment:</span>
        {mosaicEnvironmentName}
      </ScopeBadge>
      <ScopeBadge>
        <span className="text-muted-foreground/80 mr-1">Store Environment:</span>
        {storeEnvironmentLabel(storeEnvironment)}
      </ScopeBadge>
    </div>
  )
}

export function ProviderBadge({ provider }: { provider: string | undefined }) {
  return <ScopeBadge>{providerLabel(provider)}</ScopeBadge>
}

/**
 * A status treatment that is always text-first. Colour is a secondary signal,
 * never the only one.
 */
export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string
  tone?: "attention" | "negative" | "neutral" | "positive"
}) {
  const toneClass = {
    attention: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    negative: "border-destructive/35 bg-destructive/10 text-destructive",
    neutral: "border-border bg-muted/55 text-muted-foreground",
    positive: "border-primary/35 bg-primary/10 text-primary",
  }[tone]

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}
    >
      {label}
    </span>
  )
}

/** Two timestamps, always labelled, always UTC, raw ISO available on hover. */
export function DualTimestamps({
  occurredAt,
  recordedAt,
}: {
  occurredAt: string | undefined
  recordedAt: string | undefined
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
  )
}

export function DefinitionRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b py-2 last:border-b-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-right text-sm font-medium break-all">{value}</dd>
    </div>
  )
}
