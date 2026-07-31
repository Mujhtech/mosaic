import { WarningCircle } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import type { ExperimentIssue, ExperimentStatus } from "../types/experiment"

export function ExperimentStatusBadge({ status }: { status: ExperimentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize",
        status === "running" && "border-emerald-600/30 bg-emerald-500/10 text-emerald-700",
        status === "paused" && "border-amber-600/30 bg-amber-500/10 text-amber-800",
        (status === "stopped" || status === "archived") && "bg-muted text-muted-foreground",
        status === "scheduled" && "border-blue-600/30 bg-blue-500/10 text-blue-700",
      )}
    >
      {status}
    </span>
  )
}

export function ExperimentIssueCard({ issue }: { issue: ExperimentIssue }) {
  return (
    <article
      className={cn(
        "rounded border p-4",
        (issue.severity === "critical" || issue.severity === "error") &&
          "border-destructive/40 bg-destructive/5",
        issue.severity === "warning" && "border-amber-600/35 bg-amber-500/5",
      )}
      role={issue.severity === "critical" || issue.severity === "error" ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        <WarningCircle aria-hidden className="mt-0.5 shrink-0" size={20} weight="fill" />
        <div className="min-w-0 space-y-2">
          <div>
            <h3 className="text-sm font-semibold">{issue.title}</h3>
            <p className="text-muted-foreground mt-0.5 font-mono text-xs">{issue.code}</p>
            <p className="text-muted-foreground mt-1 text-sm leading-6">{issue.message}</p>
          </div>
          <dl className="grid gap-1 text-xs sm:grid-cols-2">
            <div>
              <dt className="font-semibold">Does the Experiment continue?</dt>
              <dd>{issue.continues ? "Yes — assignment continues." : "No — action is blocked."}</dd>
            </div>
            {issue.affectedResources?.length ? (
              <div>
                <dt className="font-semibold">Affected resources</dt>
                <dd>{issue.affectedResources.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
          {issue.investigation ? (
            <p className="text-xs">
              <strong>Investigate:</strong> {issue.investigation}
            </p>
          ) : null}
          {issue.recoveryAction ? (
            <p className="text-xs">
              <strong>Recovery:</strong> {issue.recoveryAction}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  )
}
