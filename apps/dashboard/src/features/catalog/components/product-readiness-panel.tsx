import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle"

import {
  readinessStateLabel,
  type ProductReadinessView,
} from "@/features/catalog/types/connected-product-view"

export function ProductReadinessPanel({ readiness }: { readiness: ProductReadinessView }) {
  const blockers = readiness.issues.filter((issue) => issue.severity === "blocker")
  const warnings = readiness.issues.filter((issue) => issue.severity === "warning")
  const healthy = readiness.state === "connected" && blockers.length === 0

  return (
    <section aria-labelledby="connected-readiness-title" className="rounded border">
      <header className="border-b px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold" id="connected-readiness-title">
              Connected readiness
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Authoritative for one explicit Environment, Application, and platform.
            </p>
          </div>
          <span
            className={
              healthy
                ? "border-primary/25 bg-primary/5 text-primary rounded-full border px-2.5 py-1 text-xs font-semibold"
                : "border-border bg-muted text-foreground rounded-full border px-2.5 py-1 text-xs font-semibold"
            }
          >
            {readinessStateLabel(readiness.state)}
          </span>
        </div>
      </header>
      <div className="space-y-4 p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded border p-3">
            <dt className="text-muted-foreground text-xs">Scope</dt>
            <dd className="mt-1 text-sm font-medium">
              {readiness.environmentId} · {readiness.applicationId} ·{" "}
              {readiness.platform.toUpperCase()}
            </dd>
          </div>
          <div className="rounded border p-3">
            <dt className="text-muted-foreground text-xs">Evaluated</dt>
            <dd className="mt-1 text-sm font-medium">{readiness.evaluatedAt}</dd>
          </div>
        </dl>

        {readiness.issues.length === 0 ? (
          <p className="text-sm">No scoped provider readiness issues were reported.</p>
        ) : (
          <div className="space-y-3">
            {blockers.length > 0 ? (
              <IssueList issues={blockers} title="Blocking issues" tone="danger" />
            ) : null}
            {warnings.length > 0 ? (
              <IssueList issues={warnings} title="Warnings" tone="neutral" />
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}

function IssueList({
  issues,
  title,
  tone,
}: {
  issues: ProductReadinessView["issues"]
  title: string
  tone: "danger" | "neutral"
}) {
  return (
    <section
      aria-label={title}
      className={
        tone === "danger"
          ? "border-destructive/25 bg-destructive/5 rounded border p-3"
          : "border-border bg-muted/35 rounded border p-3"
      }
      role={tone === "danger" ? "alert" : "status"}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <WarningCircleIcon
          aria-hidden
          className={tone === "danger" ? "text-destructive" : undefined}
          size={17}
        />
        {title}
      </p>
      <ul className="mt-2 space-y-2 text-sm">
        {issues.map((issue) => (
          <li key={`${issue.code}:${issue.resourceType}:${issue.resourceId}`}>
            <p>
              {issue.code} · {issue.resourceType} {issue.resourceId}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">Recovery: {issue.recoveryAction}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
