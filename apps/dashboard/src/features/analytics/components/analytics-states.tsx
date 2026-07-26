import { ClockCountdownIcon } from "@phosphor-icons/react/dist/ssr/ClockCountdown"
import { InfoIcon } from "@phosphor-icons/react/dist/ssr/Info"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"

import type { Freshness } from "../types/analytics"

export function FreshnessBanner({ freshness }: { freshness: Freshness }) {
  const unavailable = freshness.aggregateState === "unavailable"
  const delayed = freshness.aggregateState === "delayed"
  return (
    <div
      className={`flex items-start gap-3 rounded border p-3 text-sm ${
        unavailable || delayed ? "border-amber-500/35 bg-amber-500/8" : "bg-muted/20"
      }`}
      role={unavailable ? "alert" : "status"}
    >
      <ClockCountdownIcon aria-hidden className="mt-0.5 shrink-0" size={18} />
      <div>
        <p className="font-medium">
          {unavailable
            ? "Freshness unavailable"
            : delayed
              ? "Aggregates are delayed"
              : "Data is current"}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Latest aggregate {formatTimestamp(freshness.latestAggregatedAt)} · latest event received{" "}
          {formatTimestamp(freshness.latestReceivedAt)}. {freshness.lateEventPolicy}
        </p>
      </div>
    </div>
  )
}

export function LowDataNotice({ sampleSize }: { sampleSize: number }) {
  if (sampleSize >= 100) return null
  return (
    <div
      className="flex gap-2 rounded border border-amber-500/35 bg-amber-500/8 p-3 text-sm"
      role="status"
    >
      <WarningCircleIcon aria-hidden className="mt-0.5 shrink-0" size={18} />
      <p>
        Low data: {sampleSize.toLocaleString()}{" "}
        {sampleSize === 1 ? "presentation" : "presentations"}. Mosaic does not declare a winner
        below 100 presentations.
      </p>
    </div>
  )
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <ul className="border-border bg-muted/20 space-y-1 rounded border p-3 text-sm">
      {warnings.map((warning) => (
        <li className="flex gap-2" key={warning}>
          <InfoIcon aria-hidden className="mt-0.5 shrink-0" size={16} />
          {warning}
        </li>
      ))}
    </ul>
  )
}

function formatTimestamp(value?: string) {
  if (!value) return "not reported"
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  )
}
